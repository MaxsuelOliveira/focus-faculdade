import type Database from 'better-sqlite3';
import type { ChecklistItem, ChecklistPlan, ChecklistPlanInput } from '../shared/checklists.js';

type RawPlan = Omit<ChecklistPlan, 'items' | 'sources' | 'warnings'> & {
  sources: string;
  warnings: string;
};
type RawItem = Omit<ChecklistItem, 'source_refs' | 'done' | 'required'> & {
  source_refs: string;
  done: number;
  required: number;
};
export class ChecklistConflict extends Error {}
export class ChecklistStore {
  constructor(private db: Database.Database) {
    if (!db.prepare('SELECT 1 FROM migrations WHERE version=3').get())
      db.transaction(() => {
        db.exec(`
        CREATE TABLE checklist_plans(id INTEGER PRIMARY KEY,external_id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,course_name TEXT NOT NULL,source_url TEXT NOT NULL,personal_due_at TEXT NOT NULL,official_due_at TEXT NOT NULL,summary TEXT NOT NULL,warnings TEXT NOT NULL,sources TEXT NOT NULL,source_checked_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE checklist_items(id INTEGER PRIMARY KEY,plan_id INTEGER NOT NULL REFERENCES checklist_plans(id),slug TEXT NOT NULL,phase TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL,required INTEGER NOT NULL,source_refs TEXT NOT NULL,position INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,UNIQUE(plan_id,slug));
      `);
        db.prepare('INSERT INTO migrations(version) VALUES(3)').run();
      })();
  }
  plans(): ChecklistPlan[] {
    return (
      this.db.prepare('SELECT id FROM checklist_plans ORDER BY personal_due_at,id').all() as {
        id: number;
      }[]
    ).map((row) => this.detail(row.id));
  }
  detail(id: number): ChecklistPlan {
    const raw = this.db.prepare('SELECT * FROM checklist_plans WHERE id=?').get(id) as
      RawPlan | undefined;
    if (!raw) throw new Error('Checklist não encontrado.');
    const items = this.db
      .prepare('SELECT * FROM checklist_items WHERE plan_id=? ORDER BY position,id')
      .all(id) as RawItem[];
    return {
      ...raw,
      warnings: JSON.parse(raw.warnings),
      sources: JSON.parse(raw.sources),
      items: items.map((item) => ({
        ...item,
        required: !!item.required,
        done: !!item.done,
        source_refs: JSON.parse(item.source_refs),
      })),
    };
  }
  seed(input: ChecklistPlanInput) {
    if (new Set(input.items.map((item) => item.slug)).size !== input.items.length)
      throw new Error('Itens duplicados no checklist.');
    const sources = new Set(input.sources.map((s) => s.id));
    if (input.items.some((item) => item.source_refs.some((ref) => !sources.has(ref))))
      throw new Error('Fonte desconhecida no checklist.');
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO checklist_plans(external_id,title,course_name,source_url,personal_due_at,official_due_at,summary,warnings,sources,source_checked_at,updated_at)
        VALUES (@external_id,@title,@course_name,@source_url,@personal_due_at,@official_due_at,@summary,@warnings,@sources,@source_checked_at,@updated_at)
        ON CONFLICT(external_id) DO UPDATE SET title=excluded.title,course_name=excluded.course_name,source_url=excluded.source_url,personal_due_at=excluded.personal_due_at,official_due_at=excluded.official_due_at,summary=excluded.summary,warnings=excluded.warnings,sources=excluded.sources,source_checked_at=excluded.source_checked_at,updated_at=excluded.updated_at`,
        )
        .run({
          ...input,
          warnings: JSON.stringify(input.warnings),
          sources: JSON.stringify(input.sources),
          updated_at: now,
        });
      const { id } = this.db
        .prepare('SELECT id FROM checklist_plans WHERE external_id=?')
        .get(input.external_id) as { id: number };
      input.items.forEach((item, index) =>
        this.db
          .prepare(
            `INSERT INTO checklist_items(plan_id,slug,phase,title,description,kind,required,source_refs,position,updated_at)
        VALUES (@plan_id,@slug,@phase,@title,@description,@kind,@required,@source_refs,@position,@updated_at)
        ON CONFLICT(plan_id,slug) DO UPDATE SET phase=excluded.phase,title=excluded.title,description=excluded.description,kind=excluded.kind,required=excluded.required,source_refs=excluded.source_refs,position=excluded.position,updated_at=excluded.updated_at`,
          )
          .run({
            ...item,
            plan_id: id,
            required: Number(item.required),
            source_refs: JSON.stringify(item.source_refs),
            position: index,
            updated_at: now,
          }),
      );
      return this.detail(id);
    })();
  }
  patch(id: number, input: { revision: number; done?: boolean; notes?: string }) {
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM checklist_items WHERE id=?').get(id) as
        RawItem | undefined;
      if (!current) throw new Error('Checklist: item não encontrado.');
      if (current.revision !== input.revision)
        throw new ChecklistConflict(
          'Checklist atualizado em outra aba. Recarregue os dados e tente novamente.',
        );
      const now = new Date().toISOString();
      this.db
        .prepare(
          'UPDATE checklist_items SET done=?,notes=?,revision=revision+1,updated_at=? WHERE id=?',
        )
        .run(
          input.done === undefined ? current.done : Number(input.done),
          input.notes === undefined ? current.notes : input.notes,
          now,
          id,
        );
      this.db
        .prepare('UPDATE checklist_plans SET updated_at=? WHERE id=?')
        .run(now, current.plan_id);
      return this.detail(current.plan_id);
    })();
  }
}

export function checklistMarkdown(plan: ChecklistPlan) {
  let phase = '';
  const lines = [
    `# ${plan.title}`,
    '',
    `Meta pessoal: ${plan.personal_due_at}`,
    `Prazo oficial: ${plan.official_due_at}`,
    '',
    plan.summary,
    '',
  ];
  for (const item of plan.items) {
    if (item.phase !== phase) {
      phase = item.phase;
      lines.push(`## ${phase}`, '');
    }
    lines.push(
      `- [${item.done ? 'x' : ' '}] ${item.title} (${item.kind === 'requirement' ? 'exigência documentada' : item.kind === 'verify' ? 'conferir no AVA' : 'organização sugerida'})`,
      `  ${item.description}`,
      ...(item.notes ? [`  Notas: ${item.notes}`] : []),
      '',
    );
  }
  lines.push(
    '## Fontes',
    ...plan.sources.map((source) => `- ${source.title} — ${source.url} — ${source.detail}`),
  );
  return lines.join('\n');
}
