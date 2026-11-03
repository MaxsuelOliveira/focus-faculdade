import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/db.js';
import { LearningStore } from '../server/learning/store.js';
import { canonicalSourceKey } from '../server/learning/identity.js';
import type { LearningPacket } from '../shared/learning.js';

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-learning-'));
  const store = new Store(directory);
  const repo = new LearningStore(store);
  const c = store.course({ external_id: 'fixture', name: 'Disciplina de teste', url: '' });
  return {
    directory,
    store,
    repo,
    c,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function packet(ref: string): LearningPacket {
  return {
    title: 'Caderno',
    summary: [{ title: 'Conceito', text: 'Texto fundamentado', refs: [ref] }],
    mindmap: [{ id: 'root', parent: null, label: 'Conceito', refs: [ref] }],
    slides: [{ title: 'Conceito', bullets: ['Texto'], refs: [ref] }],
    quiz: [
      {
        prompt: 'Pergunta?',
        choices: ['Certa', 'Errada'],
        correct: 0,
        explanation: 'Explicação',
        refs: [ref],
      },
    ],
  };
}
test('session parameters do not duplicate learning sources or change their semantic hashes', () => {
  assert.notEqual(
    canonicalSourceKey('https://scorm.onilearning.com.br/item-trilha.php?Componente=unit-one'),
    canonicalSourceKey('https://scorm.onilearning.com.br/item-trilha.php?Componente=unit-two'),
  );
  const f = fixture();
  try {
    const first = f.repo.source({
      course_id: f.c.id,
      external_key:
        'https://scorm.onilearning.com.br/conteudo/componente.php?id=1&componente=ebook&acesso=fixture-a',
      title: 'Livro',
      url: 'https://scorm.onilearning.com.br/conteudo/componente.php?id=1&componente=ebook&acesso=fixture-a',
      kind: 'text',
      status: 'ready',
      content: 'Conteúdo estável',
      locator: 'p. 1',
      reason: '',
    });
    const second = f.repo.source({
      ...first,
      external_key:
        'https://scorm.onilearning.com.br/conteudo/componente.php?componente=ebook&acesso=fixture-b&id=1',
      url: 'https://scorm.onilearning.com.br/conteudo/componente.php?componente=ebook&acesso=fixture-b&id=1',
    });
    assert.equal(first.id, second.id);
    assert.equal(first.content_hash, second.content_hash);
    assert.equal(f.repo.sources(f.c.id).length, 1);
  } finally {
    f.close();
  }
});
test('explicitly excluded material is recorded without being treated as consumed evidence', () => {
  const f = fixture();
  try {
    const s = f.repo.source({
      course_id: f.c.id,
      external_key: 'read',
      title: 'Fonte lida',
      url: '',
      kind: 'text',
      status: 'ready',
      content: 'Texto financeiro.',
      locator: 'p. 1',
      reason: '',
    });
    const excluded = f.repo.source({
      course_id: f.c.id,
      external_key: 'optional',
      title: 'Livro complementar',
      url: '',
      kind: 'link',
      status: 'excluded',
      content: '',
      locator: '',
      reason: 'Não incluído por escolha do aluno.',
    });
    const r = f.repo.create(f.c.id, ['summary']);
    f.repo.snapshot(r.id);
    f.repo.status(r.id, 'needs_action');
    assert.throws(
      () => f.repo.save(r.id, packet(`source:${excluded.id}`), 'mcp', 'fixture'),
      /fonte/,
    );
    const a = f.repo.save(r.id, packet(`source:${s.id}`), 'mcp', 'fixture');
    assert.equal(a.coverage, 'complete');
    assert.equal(a.sources.find((row) => row.id === excluded.id)?.status, 'excluded');
    const course = f.repo.courses()[0] as { source_count: number; excluded_count: number };
    assert.equal(course.source_count, 1);
    assert.equal(course.excluded_count, 1);
  } finally {
    f.close();
  }
});
test('learning preserves classification, immutable artifact sources and practice after restart', () => {
  const f = fixture();
  try {
    f.repo.setState(f.c.id, 'in_progress');
    const s = f.repo.source({
      course_id: f.c.id,
      external_key: 'text:1',
      title: 'Fonte',
      url: '',
      kind: 'text',
      status: 'ready',
      content: 'Original',
      locator: 'p. 1',
      reason: '',
    });
    f.repo.source({
      course_id: f.c.id,
      external_key: 'video:1',
      title: 'Vídeo',
      url: '',
      kind: 'video',
      status: 'pending',
      content: '',
      locator: '',
      reason: 'Sem transcrição',
    });
    const r = f.repo.create(f.c.id, ['summary', 'mindmap', 'slides', 'quiz']);
    assert.equal(f.repo.create(f.c.id, ['summary']).id, r.id);
    f.repo.snapshot(r.id);
    f.repo.status(r.id, 'needs_action');
    const a = f.repo.save(r.id, packet(`source:${s.id}`), 'mcp', 'teste');
    assert.equal(a.coverage, 'partial');
    assert.equal(f.repo.practice(a.id, [0]).correct, 1);
    f.repo.source({ ...s, content: 'Atualizado' });
    assert.equal(f.repo.artifact(a.id).sources[0].content, 'Original');
    f.store.close();
    const reopened = new Store(f.directory);
    try {
      const repo = new LearningStore(reopened);
      assert.equal(repo.artifact(a.id).sources[0].content, 'Original');
      assert.equal(repo.runs()[0].status, 'completed');
      assert.equal((repo.courses()[0] as { learning_state: string }).learning_state, 'in_progress');
      assert.equal(reopened.db.prepare('SELECT count(*) n FROM learning_practice').get()?.n, 1);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
test('learning rejects unconsumed references, changed sources, invalid quiz and cyclic map', () => {
  const f = fixture();
  try {
    const s = f.repo.source({
      course_id: f.c.id,
      external_key: 'text:1',
      title: 'Fonte',
      url: '',
      kind: 'text',
      status: 'ready',
      content: 'Original',
      locator: 'p. 1',
      reason: '',
    });
    const r = f.repo.create(f.c.id, ['summary']);
    f.repo.snapshot(r.id);
    f.repo.status(r.id, 'needs_action');
    assert.throws(() => f.repo.save(r.id, packet('source:999'), 'mcp', 'teste'), /fonte/);
    const bad = packet(`source:${s.id}`);
    bad.quiz[0].correct = 2;
    assert.throws(() => f.repo.save(r.id, bad, 'mcp', 'teste'), /alternativa/);
    bad.quiz[0].correct = 0;
    bad.mindmap.push({ id: 'cycle', parent: 'cycle', label: 'Ciclo', refs: [`source:${s.id}`] });
    assert.throws(() => f.repo.save(r.id, bad, 'mcp', 'teste'), /ciclo/);
    f.repo.source({ ...s, content: 'Mudou' });
    assert.throws(() => f.repo.save(r.id, packet(`source:${s.id}`), 'mcp', 'teste'), /mudaram/);
    assert.equal(f.repo.artifacts().length, 0);
  } finally {
    f.close();
  }
});
test('each selected course gets a separate queued consumer; interrupted reads recover safely', () => {
  const f = fixture();
  try {
    const one = f.store.enqueue('learn_consume', null, { runId: '1' });
    assert.equal(f.store.enqueue('learn_consume', null, { runId: '1' }), one);
    const two = f.store.enqueue('learn_consume', null, { runId: '2' });
    assert.notEqual(two, one);
    f.store.updateJob(one, 'running', 'Consulta');
    f.store.recover();
    assert.equal(f.store.job(one).status, 'queued');
  } finally {
    f.close();
  }
});
