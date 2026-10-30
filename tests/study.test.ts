import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { parseStudyQuestions, studyMarkdown } from '../shared/study.js';
import type { AssessmentDetail } from '../shared/types.js';

test('importação preserva parágrafos, alternativas e questões discursivas', () => {
  const qs = parseStudyQuestions(
    'Questão 1\nQual capital?\n\nConsidere o Brasil.\nA) Brasília\nB) Salvador\n---\nExplique uma variável.',
  );
  assert.equal(qs.length, 2);
  assert.ok(qs[0].prompt.includes('Considere o Brasil.'));
  assert.deepEqual(
    qs[0].choices.map((c) => c.id),
    ['A', 'B'],
  );
  assert.equal(qs[1].type, 'text');
  assert.equal(parseStudyQuestions('   ').length, 0);
});

test('gabarito local persiste questões e respostas de IA sem criar ação no AVA', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-study-'));
  const store = new Store(directory);
  const app = await createApp(store);
  const headers = {
    host: '127.0.0.1:4317',
    origin: 'http://127.0.0.1:4317',
    'x-focus-client': 'local',
  };
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/study/sets',
      headers,
      payload: {
        title: 'Simulado de geografia',
        course_name: 'Geografia',
        questions: parseStudyQuestions('Qual a capital do Brasil?\nA) Brasília\nB) Salvador'),
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    const detail = created.json<AssessmentDetail>();
    const question = detail.questions[0];
    store.saveSuggestion(question.id, {
      answer: { text: '', choices: ['A'] },
      explanation: 'Brasília é a capital federal.',
      references: [],
      provider: 'ollama',
      model: 'simulado',
    });
    const markdown = studyMarkdown(store.detail(detail.assessment.id));
    assert.ok(markdown.includes('**Resposta:** A) Brasília'));
    assert.ok(markdown.includes('capital federal'));
    assert.deepEqual(store.question(question.id).answer.choices, []);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: { kind: 'extract', assessment_id: detail.assessment.id },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(store.dashboard().jobs.length, 0);
    const list = (await app.inject({ url: '/api/study/sets', headers })).json();
    assert.equal(list[0].answered_count, 1);
    assert.equal(list[0].course_name, 'Geografia');
    store.saveAnswer(question.id, { text: '', choices: ['A'] }, true);
    store.saveSuggestion(question.id, {
      answer: { text: '', choices: ['B'] },
      explanation: 'Sugestão diferente para teste de revisão.',
      references: [],
      provider: 'ollama',
      model: 'simulado',
    });
    const changed = studyMarkdown(store.detail(detail.assessment.id));
    assert.ok(changed.includes('**Resposta:** A) Brasília'));
    assert.ok(changed.includes('**Nova sugestão da IA (ainda não adotada):** B) Salvador'));
    const bad = await app.inject({
      method: 'POST',
      url: '/api/study/sets',
      headers,
      payload: {
        title: 'Inválido',
        questions: [
          {
            prompt: 'Teste',
            type: 'single',
            choices: [
              { id: 'A', text: 'X' },
              { id: 'A', text: 'Y' },
            ],
          },
        ],
      },
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(store.dashboard().assessments.length, 1);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
