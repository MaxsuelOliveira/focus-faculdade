import type { Store } from '../db.js';
import type { Assessment } from '../../shared/types.js';
import {
  isoTimestamp,
  moduleUrl,
  type PortalSnapshot,
  type ApiCalendarEvent,
} from './contracts.js';

export const portalCapabilities = {
  transport: 'http',
  browserFallback: false,
  courses: true,
  serverTimelineClassification: true,
  modules: true,
  calendar: true,
  quizAttemptState: false,
  quizTimeLimit: false,
  quizAttemptLimit: false,
  quizQuestions: false,
  explanation:
    'A sessão web autoriza catálogo, módulos e calendário. O serviço completo de questionários exige acesso adicional que não foi disponibilizado; campos ausentes não são deduzidos.',
} as const;

export class PortalStore {
  constructor(private store: Store) {
    // Date-scoped version avoids colliding with independent learning migrations.
    const version = 2026110301;
    if (store.db.prepare('SELECT 1 FROM migrations WHERE version=?').get(version)) return;
    store.db.transaction(() => {
      store.db.exec(`
      CREATE TABLE IF NOT EXISTS portal_api_courses (
        external_id TEXT PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id),
        snapshot TEXT NOT NULL,in_progress INTEGER NOT NULL,present INTEGER NOT NULL,checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS portal_api_modules (
        course_id INTEGER NOT NULL REFERENCES courses(id),external_id TEXT NOT NULL,
        snapshot TEXT NOT NULL,present INTEGER NOT NULL,checked_at TEXT NOT NULL,PRIMARY KEY(course_id,external_id));
      CREATE TABLE IF NOT EXISTS portal_api_events (
        external_id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,timestart INTEGER NOT NULL,
        timeduration INTEGER NOT NULL,checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS portal_api_syncs (
        id INTEGER PRIMARY KEY,checked_at TEXT NOT NULL,coverage_from TEXT NOT NULL,coverage_to TEXT NOT NULL,
        scope TEXT NOT NULL,course_count INTEGER NOT NULL,module_count INTEGER NOT NULL,event_count INTEGER NOT NULL);
      `);
      store.db.prepare('INSERT OR IGNORE INTO migrations(version) VALUES(?)').run(version);
    })();
  }
  save(snapshot: PortalSnapshot) {
    const db = this.store.db;
    return db.transaction(() => {
      db.prepare('UPDATE portal_api_courses SET present=0').run();
      const courseIds = new Map<number, number>();
      for (const course of snapshot.courses) {
        const saved = this.store.course({
          external_id: String(course.id),
          name: course.fullname,
          url: course.viewurl,
        });
        courseIds.set(course.id, saved.id);
        db.prepare(
          `INSERT INTO portal_api_courses VALUES (?,?,?,?,1,?) ON CONFLICT(external_id)
          DO UPDATE SET course_id=excluded.course_id,snapshot=excluded.snapshot,in_progress=excluded.in_progress,present=1,checked_at=excluded.checked_at`,
        ).run(
          String(course.id),
          saved.id,
          JSON.stringify(course),
          Number(snapshot.inProgressIds.includes(course.id)),
          snapshot.checkedAt,
        );
      }
      let modules = 0;
      for (const state of snapshot.states) {
        const courseId = courseIds.get(state.course.id);
        if (!courseId) throw new Error('A API retornou um curso fora do catálogo autorizado.');
        db.prepare('UPDATE portal_api_modules SET present=0 WHERE course_id=?').run(courseId);
        for (const module of state.cm) {
          modules++;
          db.prepare(
            `INSERT INTO portal_api_modules VALUES (?,?,?,1,?) ON CONFLICT(course_id,external_id)
            DO UPDATE SET snapshot=excluded.snapshot,present=1,checked_at=excluded.checked_at`,
          ).run(courseId, String(module.id), JSON.stringify(module), snapshot.checkedAt);
          if (module.module !== 'quiz' || !module.uservisible || !module.url) continue;
          const url = moduleUrl(module);
          const matching = snapshot.events.filter(
            (e) =>
              e.modulename === 'quiz' &&
              e.eventtype === 'close' &&
              e.course?.id === state.course.id &&
              sameActivity(e.url, url),
          );
          const deadlines = [...new Set(matching.map((e) => e.timestart))];
          // Multiple conflicting dates are exposed as uncertainty, never guessed.
          this.store.upsertAssessment({
            external_id: String(module.id),
            course_id: courseId,
            title: module.name,
            url,
            due_at: deadlines.length === 1 ? isoTimestamp(deadlines[0]) : null,
            source_timezone: 'UTC (API Moodle)',
            status: 'unknown',
          });
        }
      }
      // Replace only the fully fetched interval. Events outside coverage survive.
      const from = Date.parse(snapshot.coverage.from) / 1000;
      const to = Date.parse(snapshot.coverage.to) / 1000;
      db.prepare(
        'DELETE FROM portal_api_events WHERE timestart<=? AND timestart+timeduration>=?',
      ).run(to, from);
      for (const event of snapshot.events) {
        db.prepare(
          `INSERT INTO portal_api_events VALUES (?,?,?,?,?) ON CONFLICT(external_id)
          DO UPDATE SET snapshot=excluded.snapshot,timestart=excluded.timestart,timeduration=excluded.timeduration,checked_at=excluded.checked_at`,
        ).run(
          String(event.id),
          JSON.stringify(event),
          event.timestart,
          event.timeduration,
          snapshot.checkedAt,
        );
      }
      const id = Number(
        db
          .prepare(
            'INSERT INTO portal_api_syncs(checked_at,coverage_from,coverage_to,scope,course_count,module_count,event_count) VALUES (?,?,?,?,?,?,?)',
          )
          .run(
            snapshot.checkedAt,
            snapshot.coverage.from,
            snapshot.coverage.to,
            JSON.stringify(snapshot.scope),
            snapshot.courses.length,
            modules,
            snapshot.events.length,
          ).lastInsertRowid,
      );
      this.store.setSetting('lastSync', snapshot.checkedAt);
      this.store.setSetting('lastApiSync', snapshot.checkedAt);
      this.store.updateReminders();
      return {
        id,
        courses: snapshot.courses.length,
        modules,
        events: snapshot.events.length,
        coverage: snapshot.coverage,
      };
    })();
  }
  status() {
    const last = this.store.db
      .prepare('SELECT * FROM portal_api_syncs ORDER BY id DESC LIMIT 1')
      .get() as
      { checked_at: string; coverage_from: string; coverage_to: string; scope: string } | undefined;
    return {
      capabilities: portalCapabilities,
      lastSync: last?.checked_at || null,
      coverage: last ? { from: last.coverage_from, to: last.coverage_to } : null,
      scope: last ? JSON.parse(last.scope) : null,
    };
  }
  courses() {
    const d = this.store.dashboard();
    const rows = this.store.db.prepare('SELECT * FROM portal_api_courses').all() as {
      external_id: string;
      snapshot: string;
      in_progress: number;
      present: number;
      checked_at: string;
    }[];
    return {
      ...this.status(),
      courses: d.courses.map((c) => {
        const fact = rows.find((r) => r.external_id === c.external_id);
        const source = fact ? JSON.parse(fact.snapshot) : null;
        return {
          ...c,
          localStudy: c.external_id.startsWith('study:'),
          api: fact
            ? {
                source: 'moodle_ajax',
                checkedAt: fact.checked_at,
                presentInCatalog: !!fact.present,
                inProgress: !!fact.in_progress,
                startsAt: isoTimestamp(source.startdate),
                endsAt: isoTimestamp(source.enddate),
                hiddenInOverview: source.hidden,
              }
            : null,
          assessments: d.assessments
            .filter((a) => a.course_id === c.id)
            .map((a) => ({ ...this.projectAssessment(a), api: this.assessmentFacts(a) })),
        };
      }),
    };
  }
  assessmentFacts(a: Assessment) {
    const row = this.store.db
      .prepare(
        'SELECT snapshot,present,checked_at FROM portal_api_modules WHERE course_id=? AND external_id=?',
      )
      .get(a.course_id, a.external_id) as
      { snapshot: string; present: number; checked_at: string } | undefined;
    if (!row) return null;
    const data = JSON.parse(row.snapshot);
    const events = this.allEvents().filter(
      (e) => e.modulename === 'quiz' && e.eventtype === 'close' && sameActivity(e.url, a.url),
    );
    const dates = [...new Set(events.map((e) => e.timestart))];
    return {
      source: 'moodle_ajax',
      checkedAt: row.checked_at,
      presentInCourse: !!row.present,
      completionState: data.completionstate ?? null, // Completion is NOT attempt/submission state.
      closesAt: dates.length === 1 ? isoTimestamp(dates[0]) : null,
      deadlineAmbiguous: dates.length > 1,
      deadlineEventIds: events.map((e) => e.id),
      effectiveDeadlineIsManual: !!this.store.setting(`due:${a.course_id}:${a.external_id}`),
      attemptState: null,
      timeLimitSeconds: null,
      allowedAttempts: null,
      unavailableFields: ['attemptState', 'timeLimitSeconds', 'allowedAttempts', 'questions'],
    };
  }
  projectAssessment(a: Assessment): Assessment {
    // Preserve local observations in the original tables for review/reconciliation,
    // but never present them as newly verified structured API data.
    return this.assessmentFacts(a)
      ? { ...a, status: 'unknown', attempt_id: null, duration_minutes: null, instructions: '' }
      : a;
  }
  allEvents() {
    return (
      this.store.db
        .prepare('SELECT snapshot FROM portal_api_events ORDER BY timestart,external_id')
        .all() as { snapshot: string }[]
    ).map((r) => JSON.parse(r.snapshot) as ApiCalendarEvent);
  }
  calendar(from: string, to: string) {
    const start = Date.parse(from),
      end = Date.parse(to);
    const d = this.store.dashboard();
    const status = this.status();
    return {
      ...status,
      timezone: 'America/Bahia',
      coverageComplete:
        !!status.coverage &&
        start >= Date.parse(status.coverage.from) &&
        end <= Date.parse(status.coverage.to),
      events: this.allEvents()
        .filter((e) => e.timestart * 1000 <= end && (e.timestart + e.timeduration) * 1000 >= start)
        .map((e) => ({
          ...e,
          startsAt: isoTimestamp(e.timestart),
          endsAt: isoTimestamp(e.timestart + e.timeduration),
          source: 'moodle_api',
        })),
      assessmentDeadlines: d.assessments
        .filter((a) => a.due_at && Date.parse(a.due_at) >= start && Date.parse(a.due_at) <= end)
        .map((a) => ({ ...this.projectAssessment(a), api: this.assessmentFacts(a) })),
      withoutDeadline: d.assessments.filter((a) => !a.due_at),
    };
  }
}
function sameActivity(left: string, right: string) {
  try {
    const a = new URL(left),
      b = new URL(right);
    return (
      a.origin === b.origin &&
      a.pathname === b.pathname &&
      a.searchParams.get('id') === b.searchParams.get('id')
    );
  } catch {
    return false;
  }
}
