import { hash } from '../db.js';
import { canonicalSourceKey } from './identity.js';
export function mediaIdentity(input: string) {
  const u = new URL(input);
  if (u.hostname === 'videos-cdn.onilearning.com.br')
    u.pathname = u.pathname.replace(/\/(\d+)(?:_\d+|LEGENDA)?\.m3u8$/i, '/$1.m3u8');
  u.hash = '';
  return hash(
    u.hostname === 'videos-cdn.onilearning.com.br'
      ? [u.hostname, u.pathname]
      : canonicalSourceKey(u.href),
  );
}
export function assertMediaUrl(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    !['scorm.onilearning.com.br', 'videos-cdn.onilearning.com.br'].includes(u.hostname)
  )
    throw new Error('Origem de mídia ainda não autorizada para transcrição.');
  return u.href;
}
export function parseVtt(text: string) {
  const cues: { start: number; end: number; text: string }[] = [];
  const seconds = (s: string) =>
    s
      .split(':')
      .map(Number)
      .reduce((n, v) => n * 60 + v, 0);
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => /-->/.test(l));
    if (i < 0) continue;
    const timing = lines[i].match(
      /((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})/,
    );
    if (!timing) continue;
    const content = lines
      .slice(i + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (content) cues.push({ start: seconds(timing[1]), end: seconds(timing[2]), text: content });
  }
  return cues;
}
export async function readMediaCaptions(input: string, fetcher: typeof fetch = fetch) {
  const visited = new Set<string>();
  const queue = [input];
  const cues: ReturnType<typeof parseVtt> = [];
  while (queue.length) {
    const url = assertMediaUrl(queue.shift()!);
    if (visited.has(url)) continue;
    if (visited.size >= 300) throw new Error('Limite de segmentos de legenda.');
    visited.add(url);
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Legenda indisponível.');
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Legenda acima do limite.');
    if (text.trimStart().startsWith('WEBVTT')) {
      cues.push(...parseVtt(text));
      continue;
    }
    if (!text.trimStart().startsWith('#EXTM3U'))
      throw new Error('Formato de legenda não reconhecido.');
    const lines = text.split(/\r?\n/);
    const subtitles = lines
      .filter((l) => l.includes('TYPE=SUBTITLES'))
      .map((l) => l.match(/URI="([^"]+)"/)?.[1])
      .filter((v): v is string => !!v);
    for (const item of subtitles.length
      ? subtitles
      : lines.filter((l) => l && !l.startsWith('#') && /\.vtt(?:[?#]|$)/i.test(l)))
      queue.push(new URL(item, url).href);
  }
  if (!cues.length) throw new Error('Sem legendas acessíveis.');
  return cues.sort((a, b) => a.start - b.start);
}
