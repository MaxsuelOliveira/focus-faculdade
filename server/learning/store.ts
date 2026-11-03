import { hash, type Store } from '../db.js';
import { canonicalSourceKey } from './identity.js';
import { mediaIdentity } from './media.js';
import {
  validateLearningPacket,
  type LearningArtifact,
  type LearningPacket,
  type LearningRun,
  type LearningSource,
  type outputKinds,
} from '../../shared/learning.js';

type RawRun = Omit<LearningRun, 'outputs' | 'source_snapshot'> & {
  outputs: string;
  source_snapshot: string;
};
export class LearningStore {
  constructor(readonly store: Store) {
    const db = store.db;
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=4').get())
      db.transaction(() => {
        db.exec(`
        CREATE TABLE learning_courses(course_id INTEGER PRIMARY KEY REFERENCES courses(id), state TEXT NOT NULL DEFAULT 'unclassified', origin TEXT NOT NULL DEFAULT 'manual');
        CREATE TABLE learning_sources(id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), external_key TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL, locator TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, UNIQUE(course_id,external_key));
        CREATE TABLE learning_runs(id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), status TEXT NOT NULL, outputs TEXT NOT NULL, source_snapshot TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE UNIQUE INDEX learning_one_active ON learning_runs(course_id) WHERE status IN ('queued','running','paused','needs_action');
        CREATE TABLE learning_artifacts(id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES learning_runs(id), packet TEXT NOT NULL, sources TEXT NOT NULL, coverage TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE learning_practice(id INTEGER PRIMARY KEY, artifact_id INTEGER NOT NULL REFERENCES learning_artifacts(id), answers TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX learning_sources_course ON learning_sources(course_id,id);
      `);
        db.prepare('INSERT INTO migrations(version) VALUES(4)').run();
      })();
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=5').get())
      db.transaction(() => {
        const rows = db
          .prepare('SELECT * FROM learning_sources ORDER BY id')
          .all() as LearningSource[];
        const kept = new Map<string, LearningSource>();
        for (const row of rows) {
          const key = `${row.course_id}:${canonicalSourceKey(row.external_key)}`;
          if (kept.has(key)) db.prepare('DELETE FROM learning_sources WHERE id=?').run(row.id);
          else kept.set(key, row);
        }
        for (const row of kept.values())
          db.prepare('UPDATE learning_sources SET external_key=?,content_hash=? WHERE id=?').run(
            canonicalSourceKey(row.external_key),
            hash([row.content, row.locator, canonicalSourceKey(row.url), row.status]),
            row.id,
          );
        db.prepare('INSERT INTO migrations(version) VALUES(5)').run();
      })();
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=7').get())
      db.transaction(() => {
        const rows = db
          .prepare('SELECT * FROM learning_sources ORDER BY id')
          .all() as LearningSource[];
        for (const row of rows) {
          if (!/^https?:/.test(row.url)) continue;
          const prefix =
            row.external_key.match(/^(media:|video-page:|unread-pages:|limit:)/)?.[0] || '';
          const key = canonicalSourceKey(prefix + row.url);
          const other = db
            .prepare(
              'SELECT id FROM learning_sources WHERE course_id=? AND external_key=? AND id!=?',
            )
            .get(row.course_id, key, row.id);
          if (!other)
            db.prepare('UPDATE learning_sources SET external_key=?,content_hash=? WHERE id=?').run(
              key,
              hash([row.content, row.locator, canonicalSourceKey(row.url), row.status]),
              row.id,
            );
        }
        db.prepare('INSERT INTO migrations(version) VALUES(7)').run();
      })();
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=6').get())
      db.transaction(() => {
        db.exec(
          'CREATE TABLE learning_generation_chunks(run_id INTEGER NOT NULL REFERENCES learning_runs(id), cache_key TEXT NOT NULL, packet TEXT NOT NULL, PRIMARY KEY(run_id,cache_key))',
        );
        db.prepare('INSERT INTO migrations(version) VALUES(6)').run();
      })();
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=8').get())
      db.transaction(() => {
        db.exec(
          "CREATE TABLE learning_media(id INTEGER PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id),parent_key TEXT NOT NULL,media_key TEXT NOT NULL,title TEXT NOT NULL,page_url TEXT NOT NULL,media_url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',transcript TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,UNIQUE(course_id,media_key))",
        );
        db.prepare('INSERT INTO migrations(version) VALUES(8)').run();
      })();
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=9').get())
      db.transaction(() => {
        const rows = db
          .prepare('SELECT id,course_id,media_url FROM learning_media ORDER BY id')
          .all() as { id: number; course_id: number; media_url: string }[];
        const groups = new Map<string, typeof rows>();
        for (const row of rows) {
          const key = `${row.course_id}:${mediaIdentity(row.media_url)}`;
          groups.set(key, [...(groups.get(key) || []), row]);
        }
        for (const group of groups.values()) {
          const first = group[0];
          const preferred = group.find((r) => r.media_url.includes('LEGENDA.m3u8')) || first;
          for (const r of group.slice(1))
            db.prepare('DELETE FROM learning_media WHERE id=?').run(r.id);
          db.prepare('UPDATE learning_media SET media_key=?,media_url=? WHERE id=?').run(
            mediaIdentity(first.media_url),
            preferred.media_url,
            first.id,
          );
        }
        db.prepare('INSERT INTO migrations(version) VALUES(9)').run();
      })();
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=10').get())
      db.transaction(() => {
        for (const row of db.prepare('SELECT * FROM learning_sources').all() as LearningSource[])
          db.prepare('UPDATE learning_sources SET content_hash=? WHERE id=?').run(
            hash([row.content, row.locator, canonicalSourceKey(row.url), row.status, row.kind]),
            row.id,
          );
        db.prepare('INSERT INTO migrations(version) VALUES(10)').run();
      })();
  }
  courses() {
    return this.store.db
      .prepare(
        `SELECT c.*, COALESCE(l.state,'unclassified') learning_state, COALESCE(l.origin,'unknown') state_origin,
      (SELECT count(*) FROM learning_sources s WHERE s.course_id=c.id AND s.status!='excluded') source_count,
      (SELECT count(*) FROM learning_sources s WHERE s.course_id=c.id AND s.status='excluded') excluded_count,
      (SELECT count(*) FROM learning_sources s WHERE s.course_id=c.id AND s.status='ready') ready_count
      FROM courses c LEFT JOIN learning_courses l ON l.course_id=c.id ORDER BY c.name`,
      )
      .all();
  }
  assertCourse(id: number) {
    if (!this.store.db.prepare('SELECT 1 FROM courses WHERE id=?').get(id))
      throw new Error('Selecione uma disciplina existente.');
  }
  setState(id: number, state: string) {
    this.assertCourse(id);
    this.store.db
      .prepare(
        "INSERT INTO learning_courses(course_id,state,origin) VALUES (?,?,'manual') ON CONFLICT(course_id) DO UPDATE SET state=excluded.state,origin='manual'",
      )
      .run(id, state);
  }
  sources(courseId: number) {
    return this.store.db
      .prepare('SELECT * FROM learning_sources WHERE course_id=? ORDER BY id')
      .all(courseId) as LearningSource[];
  }
  source(input: Omit<LearningSource, 'id' | 'content_hash' | 'updated_at'>) {
    input = { ...input, external_key: canonicalSourceKey(input.external_key) };
    this.assertCourse(input.course_id);
    if (input.status === 'ready' && !input.content.trim())
      throw new Error('Informe o texto efetivamente consumido.');
    this.store.db
      .prepare(
        `INSERT INTO learning_sources(course_id,external_key,title,url,kind,status,content,content_hash,locator,reason,updated_at)
      VALUES (@course_id,@external_key,@title,@url,@kind,@status,@content,@content_hash,@locator,@reason,@updated_at)
      ON CONFLICT(course_id,external_key) DO UPDATE SET title=excluded.title,url=excluded.url,kind=excluded.kind,status=excluded.status,content=excluded.content,content_hash=excluded.content_hash,locator=excluded.locator,reason=excluded.reason,updated_at=excluded.updated_at`,
      )
      .run({
        ...input,
        content_hash: hash([
          input.content,
          input.locator,
          canonicalSourceKey(input.url),
          input.status,
          input.kind,
        ]),
        updated_at: this.store.now(),
      });
    return this.sources(input.course_id).find((s) => s.external_key === input.external_key)!;
  }
  run(id: number): LearningRun {
    const r = this.store.db.prepare('SELECT * FROM learning_runs WHERE id=?').get(id) as
      RawRun | undefined;
    if (!r) throw new Error('Selecione um consumo existente.');
    const job = this.store.db
      .prepare(
        "SELECT progress FROM jobs WHERE kind LIKE 'learn_%' AND json_extract(payload,'$.runId')=? ORDER BY id DESC LIMIT 1",
      )
      .get(String(id)) as { progress: string } | undefined;
    return {
      ...r,
      outputs: JSON.parse(r.outputs),
      source_snapshot: JSON.parse(r.source_snapshot),
      progress: job?.progress || '',
    };
  }
  runs(courseId?: number) {
    return (
      this.store.db
        .prepare(
          `SELECT id FROM learning_runs ${courseId ? 'WHERE course_id=?' : ''} ORDER BY id DESC`,
        )
        .all(...(courseId ? [courseId] : [])) as { id: number }[]
    ).map((r) => this.run(r.id));
  }
  create(courseId: number, outputs: (typeof outputKinds)[number][]) {
    this.assertCourse(courseId);
    const active = this.runs(courseId).find((r) =>
      ['queued', 'running', 'paused', 'needs_action'].includes(r.status),
    );
    if (active) return active;
    const now = this.store.now();
    const result = this.store.db
      .prepare(
        "INSERT INTO learning_runs(course_id,status,outputs,created_at,updated_at) VALUES (?,'queued',?,?,?)",
      )
      .run(courseId, JSON.stringify(outputs), now, now);
    return this.run(Number(result.lastInsertRowid));
  }
  status(id: number, status: LearningRun['status'], error = '') {
    this.run(id);
    this.store.db
      .prepare('UPDATE learning_runs SET status=?,error=?,updated_at=? WHERE id=?')
      .run(status, error, this.store.now(), id);
  }
  snapshot(id: number) {
    const r = this.run(id);
    this.store.db.prepare('UPDATE learning_runs SET source_snapshot=?,updated_at=? WHERE id=?').run(
      JSON.stringify(
        this.sources(r.course_id)
          .filter((s) => s.status === 'ready')
          .map((s) => ({ id: s.id, hash: s.content_hash })),
      ),
      this.store.now(),
      id,
    );
    return this.run(id);
  }
  artifact(id: number): LearningArtifact {
    const row = this.store.db.prepare('SELECT * FROM learning_artifacts WHERE id=?').get(id) as
      | (Omit<LearningArtifact, 'packet' | 'sources'> & { packet: string; sources: string })
      | undefined;
    if (!row) throw new Error('Selecione um caderno existente.');
    return { ...row, packet: JSON.parse(row.packet), sources: JSON.parse(row.sources) };
  }
  artifacts() {
    return (
      this.store.db.prepare('SELECT id FROM learning_artifacts ORDER BY id DESC').all() as {
        id: number;
      }[]
    ).map((r) => this.artifact(r.id));
  }
  save(id: number, packet: LearningPacket, provider: string, model: string) {
    return this.store.db.transaction(() => {
      const run = this.run(id);
      if (!['needs_action', 'running'].includes(run.status))
        throw new Error('Selecione um consumo aguardando geração.');
      const sources = this.sources(run.course_id);
      const ready = sources.filter((s) => s.status === 'ready');
      if (!ready.length || !run.source_snapshot.length)
        throw new Error('Informe fontes consumidas antes de gerar.');
      if (
        hash(run.source_snapshot) !== hash(ready.map((s) => ({ id: s.id, hash: s.content_hash })))
      )
        throw new Error('As fontes mudaram. Reconcilie o consumo antes de gerar novamente.');
      const value = validateLearningPacket(packet, new Set(ready.map((s) => `source:${s.id}`)));
      const coverage = sources.every((s) => s.status === 'ready' || s.status === 'excluded')
        ? 'complete'
        : 'partial';
      const result = this.store.db
        .prepare(
          'INSERT INTO learning_artifacts(run_id,packet,sources,coverage,created_at) VALUES (?,?,?,?,?)',
        )
        .run(id, JSON.stringify(value), JSON.stringify(sources), coverage, this.store.now());
      this.store.db
        .prepare(
          "UPDATE learning_runs SET status='completed',provider=?,model=?,updated_at=? WHERE id=?",
        )
        .run(provider, model, this.store.now(), id);
      return this.artifact(Number(result.lastInsertRowid));
    })();
  }
  practice(id: number, answers: number[]) {
    const artifact = this.artifact(id);
    if (answers.length !== artifact.packet.quiz.length)
      throw new Error('Responda todas as questões.');
    const result = artifact.packet.quiz.map((q, i) => {
      if (answers[i] < 0 || answers[i] >= q.choices.length) throw new Error('Resposta inválida.');
      return {
        correct: answers[i] === q.correct,
        expected: q.correct,
        explanation: q.explanation,
        refs: q.refs,
      };
    });
    this.store.db
      .prepare(
        'INSERT INTO learning_practice(artifact_id,answers,result,created_at) VALUES(?,?,?,?)',
      )
      .run(id, JSON.stringify(answers), JSON.stringify(result), this.store.now());
    return { result, correct: result.filter((r) => r.correct).length, total: result.length };
  }
}
