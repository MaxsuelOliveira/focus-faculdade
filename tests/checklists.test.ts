import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/db.js';
import { ChecklistStore, checklistMarkdown } from '../server/checklist-store.js';
import { piIiiAdsPlan } from '../server/plans/pi-iii-ads.js';
import { createApp } from '../server/app.js';

test('plano cobre exigências do manual, modelo e AVA com prazos distintos', () => {
  const plan = piIiiAdsPlan;
  assert.equal(plan.items.length, 34);
  assert.equal(plan.items.filter((i) => i.required).length, 28);
  assert.equal(new Date(plan.personal_due_at).toISOString(), '2026-10-31T02:59:00.000Z');
  assert.equal(new Date(plan.official_due_at).toISOString(), '2026-11-01T02:59:00.000Z');
  for (const slug of [
    'scope',
    'niche',
    'competition',
    'requirements',
    'conceptual',
    'usecase-diagram',
    'usecase-text',
    'classes',
    'sequence',
    'mer',
    'ux',
    'platform',
    'auth',
    'access',
    'catalog',
    'cart',
    'payment',
    'support-ui',
    'user-quality',
    'screens',
    'report',
    'experience',
    'learning',
    'pdf',
    'video',
    'submit-report',
    'semester-quiz',
  ]) {
    const item = plan.items.find((i) => i.slug === slug);
    assert.ok(item?.required, slug);
    assert.ok(item.source_refs.length, slug);
    for (const ref of item.source_refs) assert.ok(plan.sources.some((source) => source.id === ref));
  }
  assert.ok(plan.items.find((i) => i.slug === 'platform')?.description.includes('Etapa 3'));
  assert.ok(
    plan.items.find((i) => i.slug === 'semester-quiz')?.description.includes('única tentativa'),
  );
  assert.equal(plan.items.find((i) => i.slug === 'video-channel')?.kind, 'verify');
});
test('migração, seed idempotente, marcações, notas, exportação e reinício preservam dados', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-checklist-'));
  let store = new Store(directory);
  try {
    const repo = new ChecklistStore(store.db);
    let plan = repo.seed(piIiiAdsPlan);
    const first = plan.items[0];
    plan = repo.patch(first.id, {
      revision: first.revision,
      done: true,
      notes: 'Manual lido; revisão do app pendente.',
    });
    repo.seed(piIiiAdsPlan);
    assert.equal(repo.plans().length, 1);
    assert.equal(repo.detail(plan.id).items.length, 34);
    assert.equal(repo.detail(plan.id).items[0].done, true);
    assert.equal(repo.detail(plan.id).items[0].notes, 'Manual lido; revisão do app pendente.');
    assert.equal(store.export().checklists.length, 1);
    assert.ok(checklistMarkdown(repo.detail(plan.id)).includes('- [x] Ler o manual'));
    store.close();
    store = new Store(directory);
    assert.equal(new ChecklistStore(store.db).detail(plan.id).items[0].done, true);
    assert.equal(new ChecklistStore(store.db).detail(plan.id).items[1].done, false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('API valida atualização parcial, detecta conflito e não modifica registros do AVA', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-checklist-api-'));
  const store = new Store(directory);
  const repo = new ChecklistStore(store.db);
  const plan = repo.seed(piIiiAdsPlan);
  const app = await createApp(store);
  const headers = {
    host: '127.0.0.1:4317',
    origin: 'http://127.0.0.1:4317',
    'x-focus-client': 'local',
  };
  try {
    const item = plan.items[0];
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/checklist-items/${item.id}`,
      headers,
      payload: { revision: 0, done: true },
    });
    assert.equal(update.statusCode, 200);
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/checklist-items/${item.id}`,
      headers,
      payload: { revision: 0, notes: 'Não sobrescrever' },
    });
    assert.equal(conflict.statusCode, 409);
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/checklist-items/${item.id}`,
      headers,
      payload: { revision: 1, notes: 'x'.repeat(5001) },
    });
    assert.equal(bad.statusCode, 400);
    const note = await app.inject({
      method: 'PATCH',
      url: `/api/checklist-items/${item.id}`,
      headers,
      payload: { revision: 1, notes: 'Nota local' },
    });
    assert.equal(note.statusCode, 200);
    assert.equal(repo.detail(plan.id).items[0].done, true);
    assert.equal(repo.detail(plan.id).items[0].notes, 'Nota local');
    assert.equal(store.dashboard().jobs.length, 0);
    assert.equal(store.dashboard().receipts.length, 0);
    const exported = await app.inject({ url: `/api/checklists/${plan.id}/markdown`, headers });
    assert.equal(exported.statusCode, 200);
    assert.ok(exported.body.includes('2026-10-31T23:59:00-03:00'));
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
