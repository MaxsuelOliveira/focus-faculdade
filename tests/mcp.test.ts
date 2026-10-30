import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createMcp, localApi } from '../server/mcp.js';

test('MCP negocia protocolo e reutiliza validações da API com dados isolados', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-mcp-'));
  const store = new Store(directory);
  const app = await createApp(store);
  const course = store.course({ external_id: 'course:1', name: 'Algoritmos', url: '' });
  const assessment = store.upsertAssessment({
    external_id: 'quiz:1',
    course_id: course.id,
    title: 'Prova',
    url: '',
    status: 'in_progress',
    due_at: '2026-10-31T23:59:00-03:00',
  });
  store.replaceQuestions(
    assessment.id,
    [
      {
        external_id: 'q1',
        position: 1,
        type: 'single',
        prompt: 'Qual?',
        choices: [
          { id: 'A', text: 'Um' },
          { id: 'B', text: 'Dois' },
        ],
        images: [],
      },
    ],
    null,
  );
  const server = createMcp(async (route, method = 'GET', body) => {
    const response = await app.inject({
      method: method as 'GET' | 'POST' | 'PATCH',
      url: `/api${route}`,
      headers: {
        host: '127.0.0.1:4317',
        origin: 'http://127.0.0.1:4317',
        'x-focus-client': 'local',
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    if (response.statusCode >= 400) throw new Error('Rejected');
    return response.json();
  });
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 19);
    const calendar = await client.callTool({
      name: 'calendar',
      arguments: { from: '2026-10-31T00:00:00-03:00', to: '2026-11-01T00:00:00-03:00' },
    });
    assert.match(JSON.stringify(calendar), /Algoritmos/);
    const saved = await client.callTool({
      name: 'save_answer',
      arguments: { id: store.questions(assessment.id)[0].id, answer: { text: '', choices: ['A'] } },
    });
    assert.ok(!saved.isError);
    assert.equal(store.questions(assessment.id)[0].approved_hash, null);
    const start = await client.callTool({
      name: 'portal_job',
      arguments: { kind: 'start', assessment_id: assessment.id },
    });
    assert.equal(start.isError, true);
    const submit = await client.callTool({
      name: 'submit_assessment',
      arguments: { id: assessment.id, token: 'x'.repeat(64) },
    });
    assert.equal(submit.isError, true);
    assert.equal(store.dashboard().jobs.length, 0);
    const created = await client.callTool({
      name: 'create_study_set',
      arguments: {
        title: 'Simulado separado',
        course_id: course.id,
        questions: [{ prompt: 'Explique um algoritmo.', type: 'text', choices: [] }],
      },
    });
    assert.ok(!created.isError);
    assert.equal(store.assessment(assessment.id).attempt_id, null);
    const synced = await client.callTool({
      name: 'portal_job',
      arguments: { kind: 'sync', course_external_id: '6618' },
    });
    assert.ok(!synced.isError);
    assert.equal(store.jobPayload(store.dashboard().jobs[0].id).courseExternalId, '6618');
    const invalidTarget = await client.callTool({
      name: 'portal_job',
      arguments: { kind: 'extract', assessment_id: assessment.id, course_external_id: '6618' },
    });
    assert.equal(invalidTarget.isError, true);
    assert.ok((await client.listResources()).resources.some((r) => r.uri === 'focus://dashboard'));
    assert.ok((await client.readResource({ uri: 'focus://dashboard' })).contents.length);
    assert.ok(
      (
        await client.getPrompt({
          name: 'review_assessment',
          arguments: { assessment_id: String(assessment.id) },
        })
      ).messages.length,
    );
  } finally {
    await client.close();
    await server.close();
    await app.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('MCP aceita apenas porta válida e destino local fixo', () => {
  assert.throws(() => localApi(0));
  assert.throws(() => localApi(NaN));
  assert.throws(() => localApi(65536));
});
