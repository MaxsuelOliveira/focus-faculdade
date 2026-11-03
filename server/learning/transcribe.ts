import { execFile } from 'node:child_process';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Store } from '../db.js';
import type { Job } from '../../shared/types.js';
import { LearningStore } from './store.js';
import { assertMediaUrl, readMediaCaptions } from './media.js';
export { assertMediaUrl } from './media.js';

export function privateCommand(exe: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      exe,
      args,
      {
        windowsHide: true,
        timeout: 1_800_000,
        maxBuffer: 16_000_000,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          USERPROFILE: process.env.USERPROFILE,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          PYTHONIOENCODING: 'utf-8',
          HF_HUB_DISABLE_TELEMETRY: '1',
          HF_HUB_DISABLE_PROGRESS_BARS: '1',
        },
      },
      (err, stdout) => {
        if (err) reject(new Error('Ferramenta local não concluiu a operação.'));
        else resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });
}
const transcriptSchema = z.object({
  duration: z.number().positive().max(3600),
  language: z.string(),
  segments: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().positive(),
        text: z.string().min(1),
      }),
    )
    .min(1)
    .max(20000),
});
const stamp = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export async function transcribeLearning(store: Store, job: Job, command = privateCommand) {
  const repo = new LearningStore(store);
  const run = repo.run(Number(store.jobPayload(job.id).runId));
  if (run.status === 'paused' || run.status === 'completed') return;
  const media = store.db
    .prepare('SELECT * FROM learning_media WHERE course_id=? ORDER BY id')
    .all(run.course_id) as {
    id: number;
    parent_key: string;
    title: string;
    media_url: string;
    status: string;
    transcript: string;
  }[];
  if (!media.length) {
    repo.status(
      run.id,
      'needs_action',
      'Nenhum áudio identificado. Confira os materiais e descubra as mídias antes de transcrever.',
    );
    return;
  }
  repo.status(run.id, 'running');
  const directory = path.join(store.directory, 'learning', 'audio');
  await mkdir(directory, { recursive: true });
  try {
    for (const [i, item] of media.entries()) {
      if (repo.run(run.id).status === 'paused') return;
      if (item.status === 'ready') continue;
      repo.status(run.id, 'running');
      store.updateJob(job.id, 'running', `Transcrevendo vídeo ${i + 1} de ${media.length}`);
      try {
        const url = assertMediaUrl(item.media_url);
        if (url.includes('LEGENDA.m3u8')) {
          const cues = await readMediaCaptions(url);
          const text =
            '[Legendas fornecidas pelo player]\n' +
            cues.map((s) => `[${stamp(s.start)}–${stamp(s.end)}] ${s.text}`).join('\n');
          store.db
            .prepare(
              "UPDATE learning_media SET status='ready',transcript=?,updated_at=? WHERE id=?",
            )
            .run(text, store.now(), item.id);
          continue;
        }
        const file = path.join(directory, `${item.id}.wav`);
        const probe = JSON.parse(
          await command(process.env.FOCUS_FFPROBE || 'ffprobe', [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'json',
            url,
          ]),
        );
        const duration = Number(probe.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 3600)
          throw new Error('Duração não suportada.');
        if (!(await stat(file).catch(() => null))?.size) {
          const partial = file.replace(/\.wav$/, '.partial.wav');
          try {
            await command(process.env.FOCUS_FFMPEG || 'ffmpeg', [
              '-hide_banner',
              '-loglevel',
              'error',
              '-y',
              '-i',
              url,
              '-vn',
              '-ac',
              '1',
              '-ar',
              '16000',
              partial,
            ]);
            await rename(partial, file);
          } finally {
            await rm(partial, { force: true });
          }
        }
        const parsed = transcriptSchema.parse(
          JSON.parse(
            await command(
              process.env.FOCUS_PYTHON || 'python',
              [path.resolve('scripts/transcribe-local.py')],
              JSON.stringify({ file }),
            ),
          ),
        );
        if (
          Math.abs(parsed.duration - duration) > 2 ||
          parsed.segments.some((s) => s.end < s.start || s.end > parsed.duration + 2)
        )
          throw new Error('Marcação temporal inválida.');
        const text = parsed.segments
          .map((s) => `[${stamp(s.start)}–${stamp(s.end)}] ${s.text}`)
          .join('\n');
        store.db
          .prepare("UPDATE learning_media SET status='ready',transcript=?,updated_at=? WHERE id=?")
          .run(text, store.now(), item.id);
      } catch {
        store.db
          .prepare("UPDATE learning_media SET status='failed',updated_at=? WHERE id=?")
          .run(store.now(), item.id);
      }
    }
    for (const key of new Set(media.map((m) => m.parent_key))) {
      const all = store.db
        .prepare(
          'SELECT title,status,transcript FROM learning_media WHERE course_id=? AND parent_key=? ORDER BY id',
        )
        .all(run.course_id, key) as { title: string; status: string; transcript: string }[];
      const source = repo.sources(run.course_id).find((s) => s.external_key === key);
      if (!source) continue;
      const ready = all.filter((m) => m.status === 'ready');
      if (ready.length === all.length)
        repo.source({
          ...source,
          title: all[0].title.replace(/ · vídeo \d+$/, '') + ' · videoaulas',
          status: 'ready',
          content: ready.map((m) => `## ${m.title}\n${m.transcript}`).join('\n\n'),
          locator:
            'Legendas do player ou transcrição automática de áudio, com marcações de tempo; elementos visuais não analisados.',
          reason: '',
        });
    }
    repo.snapshot(run.id);
    repo.status(
      run.id,
      'needs_action',
      'Transcrição concluída para os áudios acessíveis. Confira fontes pendentes e revise possíveis erros de reconhecimento.',
    );
  } catch {
    repo.status(
      run.id,
      'needs_action',
      'Transcrição interrompida. Resultados concluídos foram preservados.',
    );
    throw new Error('Transcrição local não concluída.');
  }
}
