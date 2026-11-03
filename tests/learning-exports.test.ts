import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/db.js';
import { LearningStore } from '../server/learning/store.js';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { coverageNote, mindmapSvg, slidesHtml } from '../server/learning/export.js';
import type { LearningPacket } from '../shared/learning.js';

const packet = (ref: string): LearningPacket => ({
  title: 'Revisão <script>alert(1)</script>',
  summary: [{ title: 'Caixa', text: 'Entradas e saídas.', refs: [ref] }],
  slides: [
    {
      title: 'Caixa',
      bullets: ['<img src=x onerror=alert(1)>', 'Disponibilidade & prazos'],
      refs: [ref],
    },
    { title: 'Capital', bullets: ['Operação'], refs: [ref] },
  ],
  mindmap: [
    { id: 'root', parent: null, label: 'Caixa <script>', refs: [ref] },
    { id: 'child', parent: 'root', label: 'Capital & giro', refs: [ref] },
  ],
  quiz: [
    {
      prompt: 'Como acompanhar o caixa?',
      choices: ['Fluxo', 'Estoque'],
      correct: 0,
      explanation: 'O fluxo acompanha entradas e saídas.',
      refs: [ref],
    },
  ],
});
test('standalone exports preserve the map edges and slide count while escaping generated markup', () => {
  const p = packet('source:1');
  const svg = mindmapSvg(p);
  const html = slidesHtml(p);
  assert.match(svg, /<path d=/);
  assert.match(svg, /Capital &amp; giro/);
  assert.doesNotMatch(svg, /<script>/);
  assert.equal((html.match(/<section>/g) || []).length, 2);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /break-after:page/);
  const note = coverageNote({
    coverage: 'partial',
    sources: [{ status: 'excluded' }, { status: 'pending' }] as never,
  });
  assert.match(note, /1 fonte\(s\) pendente\(s\); 1 não incluída/);
  assert.match(slidesHtml(p, note), /Cobertura parcial/);
  assert.match(mindmapSvg(p, note), /Cobertura parcial/);
});
test('source pagination is lossless and exports use the saved immutable packet', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-exports-'));
  const store = new Store(directory);
  const repo = new LearningStore(store);
  const course = store.course({ external_id: 'export-test', name: 'Exemplo', url: '' });
  const text = 'Abç'.repeat(10000);
  const source = repo.source({
    course_id: course.id,
    external_key: 'fixture',
    title: 'Fonte',
    url: '',
    kind: 'text',
    status: 'ready',
    content: text,
    locator: 'p. 1',
    reason: '',
  });
  const run = repo.create(course.id, ['summary']);
  repo.snapshot(run.id);
  repo.status(run.id, 'needs_action');
  const a = repo.save(run.id, packet(`source:${source.id}`), 'mcp', 'fixture');
  const app = await createApp(store);
  const headers = { host: `127.0.0.1:${config.port}` };
  try {
    let reconstructed = '';
    for (let offset = 0; offset < text.length; offset += 12000) {
      const r = await app.inject({
        url: `/api/learning/sources/${source.id}?offset=${offset}&limit=12000`,
        headers,
      });
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().total_chars, text.length);
      reconstructed += r.json().content;
    }
    assert.equal(reconstructed, text);
    const bad = await app.inject({
      url: `/api/learning/sources/${source.id}?limit=999999`,
      headers,
    });
    assert.equal(bad.statusCode, 400);
    const svg = await app.inject({ url: `/api/learning/artifacts/${a.id}/mindmap.svg`, headers });
    assert.equal(svg.statusCode, 200);
    assert.match(String(svg.headers['content-type']), /image\/svg\+xml/);
    assert.match(String(svg.headers['content-disposition']), /attachment/);
    const html = await app.inject({ url: `/api/learning/artifacts/${a.id}/slides.html`, headers });
    assert.equal(html.statusCode, 200);
    assert.match(html.body, /Caixa/);
    const metadata = await app.inject({
      url: `/api/learning/runs/${run.id}?include_content=false`,
      headers,
    });
    assert.equal(metadata.json().sources[0].content, undefined);
    assert.equal(metadata.json().sources[0].total_chars, text.length);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
