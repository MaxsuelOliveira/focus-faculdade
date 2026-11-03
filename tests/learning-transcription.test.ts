import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/db.js';
import { LearningStore } from '../server/learning/store.js';
import { transcribeLearning, assertMediaUrl } from '../server/learning/transcribe.js';

test('transcription stores timestamps, aggregates complete video groups and preserves audio scope', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-transcription-'));
  const store = new Store(directory);
  const repo = new LearningStore(store);
  try {
    const course = store.course({ external_id: 'transcription-test', name: 'Unidade', url: '' });
    const source = repo.source({
      course_id: course.id,
      external_key: 'video-page:https://scorm.onilearning.com.br/conteudo/componente.php?id=1',
      title: 'Aula',
      url: '',
      kind: 'video',
      status: 'pending',
      content: '',
      locator: '',
      reason: 'Sem transcrição',
    });
    const run = repo.create(course.id, ['summary']);
    repo.status(run.id, 'needs_action');
    store.db
      .prepare(
        'INSERT INTO learning_media(course_id,parent_key,media_key,title,page_url,media_url,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        course.id,
        source.external_key,
        'fixture',
        'Aula 1',
        '',
        'https://scorm.onilearning.com.br/fixture.m3u8',
        store.now(),
      );
    const job = store.enqueue('learn_transcribe', null, { runId: String(run.id) });
    let calls = 0;
    await transcribeLearning(store, store.job(job), async (exe, args) => {
      calls++;
      if (exe === 'ffprobe') return JSON.stringify({ format: { duration: '5' } });
      if (exe === 'ffmpeg') {
        writeFileSync(args.at(-1)!, Buffer.alloc(100));
        return '';
      }
      return JSON.stringify({
        duration: 5,
        language: 'pt',
        segments: [{ start: 0, end: 4.8, text: 'O caixa acompanha entradas e saídas.' }],
      });
    });
    assert.equal(calls, 3);
    const actual = repo.sources(course.id)[0];
    assert.equal(actual.status, 'ready');
    assert.match(actual.content, /\[00:00–00:04\]/);
    assert.match(actual.locator, /elementos visuais não analisados/);
    assert.equal(repo.run(run.id).status, 'needs_action');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('transcription rejects arbitrary hosts and credentials before starting a subprocess', () => {
  for (const url of [
    'https://127.0.0.1/a.m3u8',
    'https://example.com/a.mp4',
    'http://scorm.onilearning.com.br/a',
    'https://user:pass@scorm.onilearning.com.br/a',
  ])
    assert.throws(() => assertMediaUrl(url));
  assert.equal(
    assertMediaUrl('https://scorm.onilearning.com.br/a.m3u8'),
    'https://scorm.onilearning.com.br/a.m3u8',
  );
});
