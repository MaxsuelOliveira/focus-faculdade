import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ChecklistStore } from './checklist-store.js';
import type {
  Answer,
  Assessment,
  AssessmentDetail,
  Choice,
  Course,
  Dashboard,
  Job,
  JobKind,
  Material,
  Question,
  QuestionType,
  Receipt,
  Reminder,
  Suggestion,
} from '../shared/types.js';

export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const answerHash = (q: Question, answer = q.answer) => hash([q.fingerprint, answer]);
export type CourseInput = Pick<Course, 'external_id' | 'name' | 'url'>;
export type AssessmentInput = Pick<Assessment, 'external_id' | 'course_id' | 'title' | 'url'> &
  Partial<Assessment>;
export type QuestionInput = {
  external_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  choices: Choice[];
  images: string[];
};
type RawQuestion = Omit<Question, 'choices' | 'images' | 'answer' | 'suggestion'> & {
  choices: string;
  images: string;
  answer: string;
  suggestion: string | null;
};

export class Store {
  db: Database.Database;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(path.join(directory, 'focus.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=2').get())
      this.db.transaction(() => {
        this.db.exec(
          'CREATE TABLE question_history(id INTEGER PRIMARY KEY,assessment_id INTEGER NOT NULL REFERENCES assessments(id),snapshot TEXT NOT NULL,archived_at TEXT NOT NULL)',
        );
        this.db.prepare('INSERT INTO migrations(version) VALUES (2)').run();
      })();
    new ChecklistStore(this.db);
  }
  migrate() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    if (this.db.prepare('SELECT 1 FROM migrations WHERE version = 1').get()) return;
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE courses (id INTEGER PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, url TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE assessments (id INTEGER PRIMARY KEY, external_id TEXT NOT NULL, course_id INTEGER NOT NULL REFERENCES courses(id), title TEXT NOT NULL, url TEXT NOT NULL, due_at TEXT, source_timezone TEXT NOT NULL DEFAULT 'America/Bahia', instructions TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unknown', attempt_id TEXT, duration_minutes INTEGER, fingerprint TEXT, updated_at TEXT NOT NULL, UNIQUE(course_id,external_id));
        CREATE TABLE questions (id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), external_id TEXT NOT NULL, position INTEGER NOT NULL, type TEXT NOT NULL, prompt TEXT NOT NULL, choices TEXT NOT NULL, images TEXT NOT NULL, fingerprint TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '{"text":"","choices":[]}', approved_hash TEXT, suggestion TEXT, updated_at TEXT NOT NULL, UNIQUE(assessment_id,external_id));
        CREATE TABLE materials (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id), title TEXT NOT NULL, content TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', selected INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE jobs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, assessment_id INTEGER REFERENCES assessments(id), status TEXT NOT NULL, progress TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE receipts (id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), attempt_id TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE confirmations (token_hash TEXT PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), fingerprint TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
        CREATE TABLE reminders (id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL REFERENCES assessments(id), due_at TEXT NOT NULL, threshold_hours INTEGER NOT NULL, notified_at TEXT, UNIQUE(assessment_id,due_at,threshold_hours));
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX jobs_status_id ON jobs(status,id);
        CREATE INDEX assessments_due ON assessments(due_at);
      `);
      this.db.prepare('INSERT INTO migrations(version) VALUES (1)').run();
    })();
  }
  now() {
    return new Date().toISOString();
  }
  course(input: CourseInput): Course {
    this.db
      .prepare(
        'INSERT INTO courses(external_id,name,url,updated_at) VALUES (@external_id,@name,@url,@updated_at) ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,url=excluded.url,updated_at=excluded.updated_at',
      )
      .run({ ...input, updated_at: this.now() });
    return this.db
      .prepare('SELECT * FROM courses WHERE external_id=?')
      .get(input.external_id) as Course;
  }
  upsertAssessment(input: AssessmentInput): Assessment {
    const previous = this.db
      .prepare('SELECT * FROM assessments WHERE course_id=? AND external_id=?')
      .get(input.course_id, input.external_id) as Assessment | undefined;
    const record = {
      due_at: null,
      source_timezone: 'America/Bahia',
      instructions: '',
      status: 'unknown',
      attempt_id: null,
      duration_minutes: null,
      fingerprint: null,
      ...previous,
      ...input,
      updated_at: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO assessments(external_id,course_id,title,url,due_at,source_timezone,instructions,status,attempt_id,duration_minutes,fingerprint,updated_at)
      VALUES (@external_id,@course_id,@title,@url,@due_at,@source_timezone,@instructions,@status,@attempt_id,@duration_minutes,@fingerprint,@updated_at)
      ON CONFLICT(course_id,external_id) DO UPDATE SET title=excluded.title,url=excluded.url,due_at=excluded.due_at,source_timezone=excluded.source_timezone,instructions=excluded.instructions,status=excluded.status,attempt_id=excluded.attempt_id,duration_minutes=excluded.duration_minutes,updated_at=excluded.updated_at`,
      )
      .run(record);
    const manual = this.setting(`due:${input.course_id}:${input.external_id}`);
    if (manual)
      this.db
        .prepare(
          'UPDATE assessments SET due_at=?,source_timezone=? WHERE course_id=? AND external_id=?',
        )
        .run(manual, 'America/Bahia (informado)', input.course_id, input.external_id);
    if (previous && previous.attempt_id !== record.attempt_id) {
      this.db
        .prepare('UPDATE questions SET approved_hash=NULL WHERE assessment_id=?')
        .run(previous.id);
      this.db.prepare('DELETE FROM confirmations WHERE assessment_id=?').run(previous.id);
    }
    return this.db
      .prepare('SELECT * FROM assessments WHERE course_id=? AND external_id=?')
      .get(input.course_id, input.external_id) as Assessment;
  }
  assessment(id: number): Assessment {
    const a = this.db
      .prepare(
        'SELECT a.*, c.name course_name FROM assessments a JOIN courses c ON c.id=a.course_id WHERE a.id=?',
      )
      .get(id) as Assessment | undefined;
    if (!a) throw new Error('Avaliação não encontrada.');
    return a;
  }
  question(id: number): Question {
    const q = this.db.prepare('SELECT * FROM questions WHERE id=?').get(id) as
      RawQuestion | undefined;
    if (!q) throw new Error('Questão não encontrada.');
    return {
      ...q,
      choices: JSON.parse(q.choices),
      images: JSON.parse(q.images),
      answer: JSON.parse(q.answer),
      suggestion: q.suggestion ? JSON.parse(q.suggestion) : null,
    };
  }
  questions(assessmentId: number): Question[] {
    return (
      this.db
        .prepare('SELECT id FROM questions WHERE assessment_id=? ORDER BY position,id')
        .all(assessmentId) as { id: number }[]
    ).map((q) => this.question(q.id));
  }
  replaceQuestions(assessmentId: number, questions: QuestionInput[], attemptId: string | null) {
    this.db.transaction(() => {
      const old = this.questions(assessmentId);
      const oldAttempt = this.assessment(assessmentId).attempt_id;
      if (
        old.length &&
        (oldAttempt !== attemptId ||
          hash(old.map((q) => [q.external_id, q.type, q.prompt, q.choices, q.images])) !==
            hash(questions.map((q) => [q.external_id, q.type, q.prompt, q.choices, q.images])))
      ) {
        this.db
          .prepare(
            'INSERT INTO question_history(assessment_id,snapshot,archived_at) VALUES (?,?,?)',
          )
          .run(
            assessmentId,
            JSON.stringify({ attempt_id: oldAttempt, questions: old }),
            this.now(),
          );
      }
      for (const q of questions) {
        const fingerprint = hash([q.external_id, q.type, q.prompt, q.choices, q.images]);
        this.db
          .prepare(
            `INSERT INTO questions(assessment_id,external_id,position,type,prompt,choices,images,fingerprint,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(assessment_id,external_id) DO UPDATE SET position=excluded.position,type=excluded.type,prompt=excluded.prompt,choices=excluded.choices,images=excluded.images,
          approved_hash=CASE WHEN questions.fingerprint=excluded.fingerprint THEN questions.approved_hash ELSE NULL END,
          suggestion=CASE WHEN questions.fingerprint=excluded.fingerprint THEN questions.suggestion ELSE NULL END,
          fingerprint=excluded.fingerprint,updated_at=excluded.updated_at`,
          )
          .run(
            assessmentId,
            q.external_id,
            q.position,
            q.type,
            q.prompt,
            JSON.stringify(q.choices),
            JSON.stringify(q.images),
            fingerprint,
            this.now(),
          );
      }
      const ids = new Set(questions.map((q) => q.external_id));
      for (const q of this.questions(assessmentId))
        if (!ids.has(q.external_id)) this.db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
      const fingerprint = hash([
        attemptId,
        this.questions(assessmentId).map((q) => [q.external_id, q.fingerprint]),
      ]);
      const a = this.assessment(assessmentId);
      if (a.attempt_id !== attemptId)
        this.db
          .prepare('UPDATE questions SET approved_hash=NULL WHERE assessment_id=?')
          .run(assessmentId);
      this.db
        .prepare('UPDATE assessments SET fingerprint=?,attempt_id=?,updated_at=? WHERE id=?')
        .run(fingerprint, attemptId, this.now(), assessmentId);
      this.db
        .prepare('DELETE FROM confirmations WHERE assessment_id=? AND fingerprint!=?')
        .run(assessmentId, this.submissionFingerprint(assessmentId));
    })();
  }
  saveAnswer(id: number, answer: Answer, approve: boolean) {
    const q = this.question(id);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM jobs WHERE assessment_id=? AND status='running' AND kind IN ('fill','submit')",
        )
        .get(q.assessment_id)
    )
      throw new Error('As respostas estão em processamento. Aguarde o término antes de editar.');
    if (q.type === 'unsupported')
      throw new Error('Esta questão exige preenchimento manual no portal.');
    const allowed = new Set(q.choices.map((c) => c.id));
    const choices = [...new Set(answer.choices)].sort();
    if (
      choices.some((c) => !allowed.has(c)) ||
      (q.type === 'single' && choices.length > 1) ||
      (q.type === 'text' && choices.length) ||
      (q.type !== 'text' && answer.text.trim())
    )
      throw new Error('Resposta incompatível com a questão.');
    if (approve && !(q.type === 'text' ? answer.text.trim() : choices.length))
      throw new Error('Preencha a resposta antes de aprovar.');
    const normalized = { text: answer.text, choices };
    this.db
      .prepare('UPDATE questions SET answer=?,approved_hash=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(normalized), approve ? answerHash(q, normalized) : null, this.now(), id);
    this.db.prepare('DELETE FROM confirmations WHERE assessment_id=?').run(q.assessment_id);
    return this.question(id);
  }
  saveSuggestion(id: number, suggestion: Suggestion) {
    this.question(id);
    this.db
      .prepare('UPDATE questions SET suggestion=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(suggestion), this.now(), id);
  }
  materials(courseId: number) {
    return this.db
      .prepare('SELECT * FROM materials WHERE course_id=? ORDER BY id DESC')
      .all(courseId) as Material[];
  }
  addMaterial(courseId: number, title: string, content: string, url = '') {
    this.db
      .prepare('INSERT INTO materials(course_id,title,content,url) VALUES (?,?,?,?)')
      .run(courseId, title, content, url);
  }
  upsertMaterial(courseId: number, title: string, content: string, url: string) {
    const previous = this.db
      .prepare('SELECT id FROM materials WHERE course_id=? AND url=?')
      .get(courseId, url) as { id: number } | undefined;
    if (previous)
      this.db
        .prepare('UPDATE materials SET title=?,content=? WHERE id=?')
        .run(title, content, previous.id);
    else this.addMaterial(courseId, title, content, url);
  }
  detail(id: number): AssessmentDetail {
    const assessment = this.assessment(id);
    return {
      assessment,
      questions: this.questions(id),
      materials: this.materials(assessment.course_id),
      receipts: this.db
        .prepare('SELECT * FROM receipts WHERE assessment_id=? ORDER BY id DESC')
        .all(id) as Receipt[],
    };
  }
  ensureReview(id: number) {
    const a = this.assessment(id);
    if (a.status !== 'in_progress' || !a.attempt_id)
      throw new Error('Extraia uma tentativa em andamento antes de preencher ou enviar.');
    if (a.due_at && Date.parse(a.due_at) <= Date.now())
      throw new Error('O prazo da avaliação está encerrado.');
    const qs = this.questions(id);
    if (!qs.length || qs.some((q) => q.type === 'unsupported' || q.approved_hash !== answerHash(q)))
      throw new Error('Revise e aprove todas as questões suportadas antes de continuar.');
    return a;
  }
  submissionFingerprint(id: number) {
    const a = this.assessment(id);
    return hash([
      a.external_id,
      a.attempt_id,
      a.fingerprint,
      a.due_at,
      a.instructions,
      a.duration_minutes,
      this.questions(id).map((q) => [q.id, q.fingerprint, q.answer, q.approved_hash]),
    ]);
  }
  confirmation(id: number) {
    this.ensureReview(id);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const fingerprint = this.submissionFingerprint(id);
    this.db
      .prepare('INSERT INTO confirmations VALUES (?,?,?,?,NULL)')
      .run(hash(token), id, fingerprint, expiresAt);
    return {
      token,
      expiresAt,
      fingerprint,
      assessment: this.assessment(id),
      questions: this.questions(id),
    };
  }
  enqueue(kind: JobKind, id: number | null, payload: object = {}) {
    if (id) this.assessment(id);
    const existing = this.db
      .prepare(
        "SELECT id FROM jobs WHERE kind=? AND assessment_id IS ? AND status IN ('queued','running')",
      )
      .get(kind, id) as { id: number } | undefined;
    if (existing) return existing.id;
    if (
      id &&
      ['start', 'fill', 'submit'].includes(kind) &&
      this.db.prepare("SELECT 1 FROM jobs WHERE assessment_id=? AND status='uncertain'").get(id)
    )
      throw new Error('Há uma operação com resultado incerto. Reconcilie a tentativa primeiro.');
    const now = this.now();
    return Number(
      this.db
        .prepare(
          "INSERT INTO jobs(kind,assessment_id,status,progress,payload,created_at,updated_at) VALUES (?,?,'queued','Aguardando execução',?,?,?)",
        )
        .run(kind, id, JSON.stringify(payload), now, now).lastInsertRowid,
    );
  }
  enqueueSubmission(id: number, token: string) {
    return this.db.transaction(() => {
      this.ensureReview(id);
      const confirmation = this.db
        .prepare('SELECT * FROM confirmations WHERE token_hash=? AND assessment_id=?')
        .get(hash(token), id) as
        { fingerprint: string; expires_at: string; used_at: string | null } | undefined;
      if (
        !confirmation ||
        confirmation.used_at ||
        Date.parse(confirmation.expires_at) < Date.now() ||
        confirmation.fingerprint !== this.submissionFingerprint(id)
      )
        throw new Error('Confirmação expirada ou respostas alteradas. Confira novamente.');
      this.db
        .prepare('UPDATE confirmations SET used_at=? WHERE token_hash=?')
        .run(this.now(), hash(token));
      return this.enqueue('submit', id, {
        fingerprint: confirmation.fingerprint,
        expiresAt: confirmation.expires_at,
      });
    })();
  }
  job(id: number) {
    return this.db
      .prepare(
        'SELECT id,kind,assessment_id,status,progress,created_at,updated_at FROM jobs WHERE id=?',
      )
      .get(id) as Job;
  }
  jobPayload(id: number) {
    return JSON.parse(
      (this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id) as { payload: string })
        .payload,
    ) as Record<string, string>;
  }
  updateJob(id: number, status: Job['status'], progress: string) {
    this.db
      .prepare('UPDATE jobs SET status=?,progress=?,updated_at=? WHERE id=?')
      .run(status, progress, this.now(), id);
  }
  nextJob() {
    const row = this.db
      .prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY id LIMIT 1")
      .get() as { id: number } | undefined;
    return row ? this.job(row.id) : undefined;
  }
  recover() {
    this.db
      .prepare(
        "UPDATE jobs SET status=CASE WHEN kind IN ('sync','inspect','extract','reconcile') THEN 'queued' ELSE 'uncertain' END,progress='Execução interrompida; aguardando recuperação',updated_at=? WHERE status='running'",
      )
      .run(this.now());
  }
  receipt(id: number, attempt: string, status: string, evidence: string) {
    this.db
      .prepare(
        'INSERT INTO receipts(assessment_id,attempt_id,status,evidence,created_at) VALUES (?,?,?,?,?)',
      )
      .run(id, attempt, status, evidence, this.now());
  }
  resolveUncertain(id: number) {
    this.db
      .prepare(
        "UPDATE jobs SET status='needs_action',progress='Estado consultado no portal. Revise antes de executar uma nova ação.',updated_at=? WHERE assessment_id=? AND status='uncertain'",
      )
      .run(this.now(), id);
  }
  setting(key: string) {
    return (
      this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  updateReminders(now = Date.now()) {
    const assessments = this.db
      .prepare(
        "SELECT * FROM assessments WHERE due_at IS NOT NULL AND status NOT IN ('submitted','closed')",
      )
      .all() as Assessment[];
    for (const a of assessments) {
      const remaining = Date.parse(a.due_at!) - now;
      if (remaining <= 0) continue;
      const crossed = [168, 72, 24, 2].filter((hours) => remaining <= hours * 3600_000);
      // Ao reabrir, emitir apenas o marco mais próximo; não quatro alertas atrasados.
      if (crossed.length)
        this.db
          .prepare(
            'INSERT OR IGNORE INTO reminders(assessment_id,due_at,threshold_hours) VALUES (?,?,?)',
          )
          .run(a.id, a.due_at, Math.min(...crossed));
    }
  }
  dashboard(): Dashboard {
    return {
      courses: this.db.prepare('SELECT * FROM courses ORDER BY name').all() as Course[],
      assessments: this.db
        .prepare(
          'SELECT a.*,c.name course_name FROM assessments a JOIN courses c ON c.id=a.course_id ORDER BY a.due_at IS NULL,a.due_at,a.id',
        )
        .all() as Assessment[],
      jobs: this.db
        .prepare(
          'SELECT id,kind,assessment_id,status,progress,created_at,updated_at FROM jobs ORDER BY id DESC LIMIT 80',
        )
        .all() as Job[],
      reminders: this.db
        .prepare(
          "SELECT r.*,a.title,c.name course_name FROM reminders r JOIN assessments a ON a.id=r.assessment_id JOIN courses c ON c.id=a.course_id WHERE r.due_at=a.due_at AND a.status NOT IN ('submitted','closed') ORDER BY r.id DESC",
        )
        .all() as Reminder[],
      receipts: this.db
        .prepare('SELECT * FROM receipts ORDER BY id DESC LIMIT 30')
        .all() as Receipt[],
      lastSync: this.setting('lastSync') || null,
    };
  }
  export() {
    return {
      version: 1,
      checklists: new ChecklistStore(this.db).plans(),
      exportedAt: this.now(),
      courses: this.dashboard().courses,
      assessments: this.dashboard().assessments.map((a) => this.detail(a.id)),
      questionHistory: (
        this.db.prepare('SELECT * FROM question_history ORDER BY id').all() as {
          snapshot: string;
        }[]
      ).map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot) })),
    };
  }
  close() {
    this.db.close();
  }
}

export function markdown(detail: AssessmentDetail) {
  return (
    `# ${detail.assessment.title}\n\n${detail.assessment.course_name}\n\n` +
    detail.questions
      .map(
        (q) =>
          `## Questão ${q.position}\n\n${q.prompt}\n\n${q.choices.map((c) => `- [${q.answer.choices.includes(c.id) ? 'x' : ' '}] ${c.text}`).join('\n')}\n\n${q.answer.text ? `Resposta revisada: ${q.answer.text}\n` : ''}`,
      )
      .join('\n')
  );
}
