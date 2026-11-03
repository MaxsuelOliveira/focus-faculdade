import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../server/db.js';
import { JobQueue } from '../server/automation/queue.js';
import { backup } from '../server/backup.js';
import { createApp } from '../server/app.js';

test('available quiz reconciliation clears only uncertain starts', () => {
  const f = fixture();
  try {
    const start = f.store.enqueue('start', f.assessment.id);
    const fill = f.store.enqueue('fill', f.assessment.id);
    const submit = f.store.enqueue('submit', f.assessment.id);
    for (const id of [start, fill, submit]) f.store.updateJob(id, 'uncertain', 'Interrupted');
    f.store.resolveUncertainStart(f.assessment.id);
    assert.equal(f.store.job(start).status, 'needs_action');
    assert.equal(f.store.job(fill).status, 'uncertain');
    assert.equal(f.store.job(submit).status, 'uncertain');
    assert.throws(() => f.store.enqueue('start', f.assessment.id), /resultado incerto/);
  } finally {
    f.cleanup();
  }
});

export function fixture(directory = mkdtempSync(path.join(tmpdir(), 'focus-test-'))) {
  const store = new Store(directory);
  const course = store.course({
    external_id: '8683',
    name: 'Disciplina de teste',
    url: 'https://graduacao.faculdadefocus.edu.br/course/view.php?id=8683',
  });
  const assessment = store.upsertAssessment({
    external_id: '1',
    course_id: course.id,
    title: 'Avaliação de teste',
    url: 'https://graduacao.faculdadefocus.edu.br/mod/quiz/view.php?id=1',
    status: 'in_progress',
    attempt_id: '42',
    due_at: new Date(Date.now() + 12 * 3600000).toISOString(),
  });
  store.replaceQuestions(
    assessment.id,
    [
      {
        external_id: 'question-42-1',
        position: 1,
        type: 'single',
        prompt: 'Qual é o resultado de 2 + 2?',
        choices: [
          { id: '0', text: '3' },
          { id: '1', text: '4' },
        ],
        images: [],
      },
    ],
    '42',
  );
  return {
    store,
    assessment,
    course,
    directory,
    cleanup: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('migrações e sincronização são idempotentes; informações persistem ao reiniciar', () => {
  const f = fixture();
  f.store.course({ external_id: '8683', name: 'Disciplina atualizada', url: f.course.url });
  f.store.upsertAssessment({ ...f.assessment, title: 'Título atualizado' });
  const q = f.store.questions(f.assessment.id)[0];
  f.store.saveAnswer(q.id, { text: '', choices: ['1'] }, true);
  f.store.close();
  const reopened = new Store(f.directory);
  assert.equal(reopened.dashboard().courses.length, 1);
  assert.equal(reopened.dashboard().assessments.length, 1);
  assert.equal(reopened.question(q.id).answer.choices[0], '1');
  assert.ok(reopened.question(q.id).approved_hash);
  assert.equal(reopened.db.pragma('journal_mode', { simple: true }), 'wal');
  reopened.close();
  rmSync(f.directory, { recursive: true, force: true });
});
test('resposta editada e questão alterada invalidam aprovação e confirmação', () => {
  const f = fixture();
  try {
    const q = f.store.questions(f.assessment.id)[0];
    assert.throws(() => f.store.confirmation(f.assessment.id), /Revise/);
    f.store.saveAnswer(q.id, { text: '', choices: ['1'] }, true);
    const confirmation = f.store.confirmation(f.assessment.id);
    f.store.saveAnswer(q.id, { text: '', choices: ['0'] }, false);
    assert.equal(f.store.question(q.id).approved_hash, null);
    assert.throws(() => f.store.enqueueSubmission(f.assessment.id, confirmation.token));
    f.store.saveAnswer(q.id, { text: '', choices: ['1'] }, true);
    f.store.replaceQuestions(f.assessment.id, [{ ...q, prompt: 'Enunciado alterado' }], '42');
    assert.equal(f.store.question(q.id).approved_hash, null);
  } finally {
    f.cleanup();
  }
});
test('confirmação só pode ser usada uma vez, expira e exige tentativa aberta', () => {
  const f = fixture();
  try {
    const q = f.store.questions(f.assessment.id)[0];
    f.store.saveAnswer(q.id, { text: '', choices: ['1'] }, true);
    const expired = f.store.confirmation(f.assessment.id);
    f.store.db.prepare('UPDATE confirmations SET expires_at=?').run(new Date(0).toISOString());
    assert.throws(() => f.store.enqueueSubmission(f.assessment.id, expired.token), /Confirmação/);
    const valid = f.store.confirmation(f.assessment.id);
    const job = f.store.enqueueSubmission(f.assessment.id, valid.token);
    assert.equal(f.store.job(job).kind, 'submit');
    assert.throws(() => f.store.enqueueSubmission(f.assessment.id, valid.token), /Confirmação/);
    f.store.upsertAssessment({
      ...f.store.assessment(f.assessment.id),
      due_at: new Date(0).toISOString(),
    });
    assert.throws(() => f.store.ensureReview(f.assessment.id), /prazo/);
  } finally {
    f.cleanup();
  }
});
test('alternativas inválidas e resposta vazia não podem ser aprovadas', () => {
  const f = fixture();
  try {
    const q = f.store.questions(f.assessment.id)[0];
    assert.throws(
      () => f.store.saveAnswer(q.id, { text: '', choices: ['inexistente'] }, true),
      /incompatível/,
    );
    assert.throws(() => f.store.saveAnswer(q.id, { text: '', choices: [] }, true), /Preencha/);
    assert.throws(
      () => f.store.saveAnswer(q.id, { text: '', choices: ['0', '1'] }, true),
      /incompatível/,
    );
  } finally {
    f.cleanup();
  }
});
test('lembretes são deduplicados e não são emitidos após entrega', () => {
  const f = fixture();
  try {
    f.store.updateReminders();
    f.store.updateReminders();
    assert.equal(f.store.dashboard().reminders.length, 1);
    assert.equal(f.store.dashboard().reminders[0].threshold_hours, 24);
    f.store.upsertAssessment({ ...f.store.assessment(f.assessment.id), status: 'submitted' });
    assert.equal(f.store.dashboard().reminders.length, 0);
  } finally {
    f.cleanup();
  }
});
test('fila serializa execuções e recupera operações interrompidas sem reenviar', async () => {
  const f = fixture();
  try {
    const read = f.store.enqueue('sync', null);
    const submit = f.store.enqueue('submit', f.assessment.id);
    f.store.updateJob(read, 'running', 'teste');
    f.store.updateJob(submit, 'running', 'teste');
    let concurrent = 0;
    let maximum = 0;
    const queue = new JobQueue(f.store, async () => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      concurrent--;
    });
    assert.equal(f.store.job(read).status, 'queued');
    assert.equal(f.store.job(submit).status, 'uncertain');
    assert.throws(() => f.store.enqueue('submit', f.assessment.id), /incerto/);
    await Promise.all([queue.tick(), queue.tick(), queue.tick()]);
    assert.equal(maximum, 1);
    assert.equal(f.store.job(read).status, 'completed');
  } finally {
    f.cleanup();
  }
});
test('backup SQLite preserva dados com WAL ativo', async () => {
  const f = fixture();
  try {
    const filename = await backup(f.store, true);
    assert.ok(filename?.endsWith('.sqlite'));
    assert.equal(f.store.setting('lastBackup'), new Date().toISOString().slice(0, 10));
  } finally {
    f.cleanup();
  }
});
test('restauração valida backup, recupera dados e preserva banco anterior', async () => {
  const f = fixture();
  try {
    const filename = await backup(f.store, true);
    f.store.db.prepare('UPDATE courses SET name=?').run('Nome posterior ao backup');
    f.store.close();
    const restored = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/restore.ts',
        path.join(f.directory, 'backups', filename!),
        '--app-stopped',
      ],
      { cwd: process.cwd(), env: { ...process.env, DATA_DIR: f.directory }, encoding: 'utf8' },
    );
    assert.equal(restored.status, 0, restored.stderr);
    const reopened = new Store(f.directory);
    assert.equal(reopened.dashboard().courses[0].name, 'Disciplina de teste');
    reopened.close();
  } finally {
    if (f.store.db.open) f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test('troca de tentativa invalida revisão mesmo antes de extrair questões', () => {
  const f = fixture();
  try {
    const q = f.store.questions(f.assessment.id)[0];
    f.store.saveAnswer(q.id, { text: '', choices: ['1'] }, true);
    f.store.upsertAssessment({
      ...f.store.assessment(f.assessment.id),
      attempt_id: 'outra-tentativa',
    });
    assert.equal(f.store.question(q.id).approved_hash, null);
  } finally {
    f.cleanup();
  }
});
test('API rejeita host e origem externos, e não exporta credenciais ou tokens', async () => {
  const f = fixture();
  const app = await createApp(f.store);
  try {
    const headers = {
      host: '127.0.0.1:4317',
      origin: 'http://127.0.0.1:4317',
      'x-focus-client': 'local',
    };
    assert.equal(
      (await app.inject({ url: '/api/dashboard', headers: { host: 'evil.example' } })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/jobs',
          headers: { ...headers, origin: 'https://evil.example' },
          payload: { kind: 'sync' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { kind: 'sync' } }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/jobs',
          headers,
          payload: { kind: 'start', assessment_id: f.assessment.id },
        })
      ).statusCode,
      400,
    );
    const exported = (await app.inject({ url: '/api/export', headers })).body;
    assert.ok(!/PASSWORD|USERNAME|token_hash|OPENAI_API_KEY/.test(exported));
  } finally {
    await app.close();
    f.cleanup();
  }
});
