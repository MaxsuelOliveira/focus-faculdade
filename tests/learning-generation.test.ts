import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/db.js';
import { LearningStore } from '../server/learning/store.js';
import {
  generateLearning,
  learningChunks,
  mergeLearningPackets,
  contradictoryVerdict,
} from '../server/learning/generate.js';
import type { LearningPacket, LearningSource } from '../shared/learning.js';

const packet = (ref: string): LearningPacket => ({
  title: 'Conceitos',
  summary: [{ title: 'Caixa', text: 'Explicação com evidência.', refs: [ref] }],
  slides: [
    { title: 'Caixa', bullets: ['Entradas e saídas', 'Disponibilidade no tempo'], refs: [ref] },
  ],
  mindmap: [{ id: 'root', parent: null, label: 'Caixa', refs: [ref] }],
  quiz: [
    {
      prompt: 'O que acompanha o caixa?',
      choices: ['Entradas e saídas', 'Somente lucro', 'Somente receitas', 'Somente estoques'],
      correct: 0,
      explanation: 'O fluxo acompanha a disponibilidade.',
      refs: [ref],
    },
  ],
});
test('chunking includes the complete source and excludes pending text', () => {
  const source = {
    id: 1,
    external_key: 'fixture',
    kind: 'text',
    title: 'Fonte',
    status: 'ready',
    content: 'x'.repeat(25001),
  } as LearningSource;
  const chunks = learningChunks([source, { ...source, id: 2, status: 'pending' }]);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.map((c) => c.text).join(''), source.content);
  assert.equal(chunks[2].part, 3);
  assert.equal(
    learningChunks([source, { ...source, id: 3, external_key: 'alternate-url' }]).length,
    3,
  );
  assert.equal(
    learningChunks([{ ...source, kind: 'image', content: 'Caixa: entradas e saídas.' }]).length,
    1,
  );
  assert.equal(learningChunks([{ ...source, kind: 'link' }]).length, 0);
  const merged = mergeLearningPackets('Disciplina', [packet('source:1'), packet('source:2')]);
  assert.equal(merged.mindmap.filter((n) => n.parent === null).length, 1);
  assert.equal(new Set(merged.mindmap.map((n) => n.id)).size, 3);
  assert.equal(merged.quiz.length, 2);
});
test('local generation persists a grounded packet and caches completed blocks', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-generation-'));
  const store = new Store(directory);
  const repo = new LearningStore(store);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    const course = store.course({ external_id: 'local-generation', name: 'Finanças', url: '' });
    const source = repo.source({
      course_id: course.id,
      external_key: 'text',
      title: 'Material',
      url: '',
      kind: 'text',
      status: 'ready',
      content: 'Conteúdo financeiro de teste. '.repeat(60),
      locator: 'p. 1',
      reason: '',
    });
    const run = repo.create(course.id, ['summary', 'mindmap', 'slides', 'quiz']);
    repo.snapshot(run.id);
    const jobId = store.enqueue('learn_generate', null, {
      runId: String(run.id),
      model: 'fixture-model',
    });
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/api/tags'))
        return new Response(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
      calls++;
      if (JSON.parse(String(init?.body)).messages[0].content.includes('revisor crítico'))
        return new Response(
          JSON.stringify({ message: { content: JSON.stringify({ valid: true, reason: '' }) } }),
        );
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify(packet(`source:${source.id}`)) } }),
      );
    };
    await generateLearning(store, store.job(jobId));
    assert.equal(repo.run(run.id).status, 'completed');
    assert.equal(repo.artifacts().length, 1);
    assert.equal(calls, 2);
    assert.equal(store.db.prepare('SELECT count(*) n FROM learning_generation_chunks').get()?.n, 1);
    assert.equal(repo.artifacts()[0].sources[0].content, source.content);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generation refuses a semantically rejected block after bounded corrective attempts', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-review-'));
  const store = new Store(directory);
  const repo = new LearningStore(store);
  const originalFetch = globalThis.fetch;
  let revisions = 0;
  try {
    const course = store.course({ external_id: 'review', name: 'Finanças', url: '' });
    const source = repo.source({
      course_id: course.id,
      external_key: 'math',
      title: 'Juros',
      url: '',
      kind: 'text',
      status: 'ready',
      content: '3000 vezes 1,2 ao quadrado resulta em 4320; os juros são 1320.',
      locator: 'p. 1',
      reason: '',
    });
    const run = repo.create(course.id, ['quiz']);
    repo.snapshot(run.id);
    const jobId = store.enqueue('learn_generate', null, {
      runId: String(run.id),
      model: 'fixture-model',
    });
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/api/tags'))
        return new Response(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
      const request = JSON.parse(String(init?.body));
      if (request.messages[0].content.includes('revisor crítico')) {
        revisions++;
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                valid: false,
                reason: 'O resultado 1320 não consta nas alternativas.',
              }),
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify(packet('source:' + source.id)) } }),
      );
    };
    await assert.rejects(generateLearning(store, store.job(jobId)), /não concluiu/);
    assert.equal(revisions, 3);
    assert.equal(repo.run(run.id).status, 'needs_action');
    assert.equal(repo.artifacts().length, 0);
    assert.equal(store.db.prepare('SELECT count(*) n FROM learning_generation_chunks').get()?.n, 0);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('contradictory positive verdicts cannot approve an absent or incorrect alternative', () => {
  assert.equal(
    contradictoryVerdict('Aprovo. O valor correto é 1320, mas não está nas opções.'),
    true,
  );
  assert.equal(contradictoryVerdict('Nenhuma alternativa está correta.'), true);
  assert.equal(contradictoryVerdict('O resultado corresponde à alternativa marcada.'), false);
});
