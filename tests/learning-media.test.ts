import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaIdentity, parseVtt, readMediaCaptions } from '../server/learning/media.js';
test('video renditions and subtitles have one identity, while different lessons remain distinct', () => {
  assert.notEqual(
    mediaIdentity('https://scorm.onilearning.com.br/video.php?id=1'),
    mediaIdentity('https://scorm.onilearning.com.br/video.php?id=2'),
  );
  const base = 'https://videos-cdn.onilearning.com.br/1/100/100';
  assert.equal(mediaIdentity(base + '.m3u8'), mediaIdentity(base + '_360.m3u8'));
  assert.equal(mediaIdentity(base + '.m3u8'), mediaIdentity(base + 'LEGENDA.m3u8'));
  assert.notEqual(
    mediaIdentity(base + '.m3u8'),
    mediaIdentity('https://videos-cdn.onilearning.com.br/1/101/101.m3u8'),
  );
});
test('VTT and HLS captions preserve timestamps and reject external segment redirects', async () => {
  const vtt =
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\n<b>Caixa</b> &amp; capital\n\n2\n00:00:04.000 --> 00:00:06.000\nPrazo de pagamento';
  assert.deepEqual(parseVtt(vtt)[0], { start: 1, end: 3.5, text: 'Caixa & capital' });
  const cues = await readMediaCaptions(
    'https://videos-cdn.onilearning.com.br/aLEGENDA.m3u8',
    async (input) =>
      new Response(
        String(input).endsWith('.vtt') ? vtt : '#EXTM3U\n#EXTINF:6,\na.vtt\n#EXT-X-ENDLIST',
      ),
  );
  assert.equal(cues.length, 2);
  await assert.rejects(
    () =>
      readMediaCaptions(
        'https://videos-cdn.onilearning.com.br/aLEGENDA.m3u8',
        async () => new Response('#EXTM3U\nhttps://127.0.0.1/private.vtt'),
      ),
    /Origem/,
  );
});
