import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../db.js';
import { courseStateSchema, learningPacketSchema, outputKinds } from '../../shared/learning.js';
import { LearningStore } from './store.js';
import { models } from '../ai.js';
import { coverageNote, mindmapSvg, slidesHtml } from './export.js';

const id = z.coerce.number().int().positive();
export async function registerLearning(app: FastifyInstance, store: Store) {
  const repo = new LearningStore(store);
  app.get('/api/learning', async () => ({
    courses: repo.courses(),
    runs: repo.runs(),
    artifacts: repo.artifacts(),
  }));
  app.post('/api/learning/discover', async () => store.enqueue('learn_discover', null));
  app.patch('/api/learning/sources/:id/inclusion', async (req) => {
    const source = store.db
      .prepare('SELECT * FROM learning_sources WHERE id=?')
      .get(id.parse((req.params as { id: string }).id)) as
      import('../../shared/learning.js').LearningSource | undefined;
    if (!source) throw new Error('Selecione uma fonte existente.');
    const body = z
      .object({ included: z.boolean(), reason: z.string().trim().min(5).max(1000) })
      .parse(req.body);
    if (
      (body.included || source.status === 'ready') &&
      repo.runs(source.course_id).some((r) => ['queued', 'running'].includes(r.status))
    )
      throw new Error('Há uma operação em andamento. Pause antes de alterar o contexto.');
    return repo.source({
      ...source,
      status: body.included ? (source.content.trim() ? 'ready' : 'pending') : 'excluded',
      reason: body.reason,
    });
  });
  app.get('/api/learning/sources/:id', async (req) => {
    const source = store.db
      .prepare('SELECT * FROM learning_sources WHERE id=?')
      .get(id.parse((req.params as { id: string }).id)) as
      import('../../shared/learning.js').LearningSource | undefined;
    if (!source) throw new Error('Selecione uma fonte existente.');
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(20000).default(12000),
      })
      .parse(req.query);
    return {
      ...source,
      content: source.content.slice(q.offset, q.offset + q.limit),
      offset: q.offset,
      total_chars: source.content.length,
    };
  });
  app.post('/api/learning/runs/:id/transcribe', async (req) => {
    const run = repo.run(id.parse((req.params as { id: string }).id));
    if (!['needs_action', 'paused'].includes(run.status))
      throw new Error('Selecione um consumo aguardando transcrição.');
    repo.status(run.id, 'queued');
    return { job_id: store.enqueue('learn_transcribe', null, { runId: String(run.id) }) };
  });
  app.post('/api/learning/runs/:id/generate', async (req) => {
    const run = repo.run(id.parse((req.params as { id: string }).id));
    const body = z.object({ model: z.string().trim().min(1).max(200) }).parse(req.body);
    if (!['needs_action', 'paused'].includes(run.status))
      throw new Error('Selecione um consumo aguardando geração.');
    if (!(await models()).models.includes(body.model))
      throw new Error('Selecione um modelo instalado no Ollama.');
    return store.db.transaction(() => {
      repo.snapshot(run.id);
      repo.status(run.id, 'queued');
      return {
        job_id: store.enqueue('learn_generate', null, { runId: String(run.id), model: body.model }),
      };
    })();
  });
  app.patch('/api/learning/courses/:id', async (req) => {
    const body = z.object({ state: courseStateSchema }).parse(req.body);
    repo.setState(id.parse((req.params as { id: string }).id), body.state);
    return { ok: true };
  });
  app.get('/api/learning/courses/:id/sources', async (req) =>
    repo.sources(id.parse((req.params as { id: string }).id)),
  );
  app.post('/api/learning/runs', async (req) => {
    const b = z
      .object({
        course_ids: z.array(id).min(1).max(30),
        outputs: z.array(z.enum(outputKinds)).min(1),
      })
      .parse(req.body);
    return store.db.transaction(() =>
      [...new Set(b.course_ids)].map((courseId) => {
        const run = repo.create(courseId, [...new Set(b.outputs)]);
        if (run.status === 'queued')
          store.enqueue('learn_consume', null, { runId: String(run.id) });
        return run;
      }),
    )();
  });
  app.get('/api/learning/runs/:id', async (req) => {
    const run = repo.run(id.parse((req.params as { id: string }).id));
    return {
      run,
      sources: repo
        .sources(run.course_id)
        .map((s) =>
          (req.query as { include_content?: string }).include_content === 'false'
            ? { ...s, content: undefined, total_chars: s.content.length }
            : s,
        ),
      media: store.db
        .prepare(
          'SELECT id,title,status,updated_at FROM learning_media WHERE course_id=? ORDER BY id',
        )
        .all(run.course_id),
      artifacts: repo.artifacts().filter((a) => a.run_id === run.id),
    };
  });
  app.post('/api/learning/runs/:id/control', async (req) => {
    const run = repo.run(id.parse((req.params as { id: string }).id));
    const { action } = z
      .object({ action: z.enum(['pause', 'resume', 'reconcile']) })
      .parse(req.body);
    if (run.status === 'completed')
      throw new Error('Selecione um novo consumo para atualizar o caderno.');
    if (action === 'pause') repo.status(run.id, 'paused');
    else {
      if (run.status === 'running')
        throw new Error('Há uma operação em andamento. Pause antes de retomar.');
      repo.status(run.id, 'queued');
      const latest = store.db
        .prepare(
          "SELECT id,kind FROM jobs WHERE json_extract(payload,'$.runId')=? ORDER BY id DESC LIMIT 1",
        )
        .get(String(run.id)) as { id: number; kind: string } | undefined;
      if (
        action === 'resume' &&
        latest &&
        ['learn_generate', 'learn_transcribe'].includes(latest.kind)
      )
        store.enqueue(
          latest.kind as 'learn_generate' | 'learn_transcribe',
          null,
          store.jobPayload(latest.id),
        );
      else store.enqueue('learn_consume', null, { runId: String(run.id) });
    }
    return repo.run(run.id);
  });
  app.post('/api/learning/sources', async (req) => {
    const b = z
      .object({
        course_id: id,
        external_key: z.string().min(1).max(500),
        title: z.string().min(1).max(300),
        url: z.string().max(2000).default(''),
        kind: z.enum(['text', 'pdf', 'video', 'link', 'image']),
        content: z.string().trim().min(1).max(1_500_000),
        locator: z.string().min(1).max(500),
      })
      .parse(req.body);
    if (repo.runs(b.course_id).some((r) => ['running', 'queued'].includes(r.status)))
      throw new Error('Há uma operação em andamento. Pause antes de editar fontes.');
    return repo.source({ ...b, status: 'ready', reason: '' });
  });
  app.post('/api/learning/runs/:id/packet', async (req) => {
    const b = z
      .object({
        packet: learningPacketSchema,
        provider: z.literal('mcp'),
        model: z.string().min(1).max(200),
      })
      .parse(req.body);
    const runId = id.parse((req.params as { id: string }).id);
    if (repo.run(runId).status !== 'needs_action')
      throw new Error(
        'Há uma operação em andamento ou o consumo não aguarda geração. Confira o estado antes de salvar.',
      );
    return repo.save(runId, b.packet, b.provider, b.model);
  });
  app.get('/api/learning/artifacts/:id/markdown', async (req, reply) => {
    const a = repo.artifact(id.parse((req.params as { id: string }).id));
    const sources = a.sources;
    const refs = (rs: string[]) =>
      rs
        .map((r) => {
          const s = sources.find((s) => `source:${s.id}` === r);
          return s ? `${r}: ${s.title} — ${s.locator}` : r;
        })
        .join('; ');
    const text = `# ${a.packet.title}\n\nCobertura: ${coverageNote(a)}\nGerado por IA, para revisão.\n\n${a.packet.summary.map((s) => `## ${s.title}\n\n${s.text}\n\nFontes: ${refs(s.refs)}`).join('\n\n')}\n\n## Slides\n\n${a.packet.slides.map((s) => `### ${s.title}\n${s.bullets.map((b) => `- ${b}`).join('\n')}\nFontes: ${refs(s.refs)}`).join('\n\n')}\n\n## Mapa mental\n\n${a.packet.mindmap.map((n) => `- ${n.label} (pai: ${n.parent || 'raiz'}) — Fontes: ${refs(n.refs)}`).join('\n')}\n\n## Fontes não incluídas ou pendentes\n\n${
      sources
        .filter((s) => s.status !== 'ready')
        .map(
          (s) =>
            `- ${s.title}: ${s.status === 'excluded' ? 'não incluída' : 'pendente'}. ${s.reason}`,
        )
        .join('\n') || 'Nenhuma.'
    }\n\n## Simulado\n\n${a.packet.quiz.map((q, i) => `### ${i + 1}. ${q.prompt}\n${q.choices.map((c, j) => `${String.fromCharCode(65 + j)}. ${c}`).join('\n')}\n\nGabarito: ${String.fromCharCode(65 + q.correct)}. ${q.explanation}\nFontes: ${refs(q.refs)}`).join('\n\n')}`;
    return reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="caderno.md"')
      .send(text);
  });
  app.post('/api/learning/artifacts/:id/practice', async (req) =>
    repo.practice(
      id.parse((req.params as { id: string }).id),
      z.object({ answers: z.array(z.number().int().nonnegative()).min(1).max(100) }).parse(req.body)
        .answers,
    ),
  );
  app.get('/api/learning/artifacts/:id/mindmap.svg', async (req, reply) =>
    reply
      .type('image/svg+xml; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="mapa-mental.svg"')
      .send(
        (() => {
          const a = repo.artifact(id.parse((req.params as { id: string }).id));
          return mindmapSvg(a.packet, coverageNote(a));
        })(),
      ),
  );
  app.get('/api/learning/artifacts/:id/slides.html', async (req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="slides.html"')
      .send(
        (() => {
          const a = repo.artifact(id.parse((req.params as { id: string }).id));
          return slidesHtml(a.packet, coverageNote(a));
        })(),
      ),
  );
}
