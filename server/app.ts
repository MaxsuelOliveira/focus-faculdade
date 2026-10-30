import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Store, markdown, hash } from './db.js';
import { config } from './config.js';
import { models, suggest } from './ai.js';
import { backup } from './backup.js';
import type { JobQueue } from './automation/queue.js';
import { registerStudy } from './study.js';
import { registerChecklists } from './checklists.js';

const positive = z.coerce.number().int().positive();
const answerSchema = z.object({
  answer: z.object({ text: z.string().max(30000), choices: z.array(z.string().max(200)).max(100) }),
  approve: z.boolean(),
});

export async function createApp(store: Store, queue?: JobQueue) {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000, requestTimeout: 200_000 });
  const trustedHosts = new Set([`127.0.0.1:${config.port}`, '127.0.0.1:5173']);
  app.addHook('onRequest', async (request, reply) => {
    if (!trustedHosts.has(request.headers.host || ''))
      return reply.code(403).send({ error: 'Host não autorizado.' });
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://graduacao.faculdadefocus.edu.br; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const allowed = new Set([`http://127.0.0.1:${config.port}`, 'http://127.0.0.1:5173']);
      if (
        !request.headers.origin ||
        !allowed.has(request.headers.origin) ||
        request.headers['x-focus-client'] !== 'local'
      )
        return reply.code(403).send({ error: 'Origem não autorizada.' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: 'Dados inválidos. Confira os campos informados.' });
    const message = error instanceof Error ? error.message : '';
    // Não retornar erros de SQL, navegador, rede nem valores privados.
    const exposed =
      /^(Avaliação|Questão|Resposta|Preencha|Revise|Extraia|O prazo|Confirmação|Há uma|Esta questão|Selecione|Ollama|A API|Informe|O provedor|A IA|A sugestão|As respostas|Outra geração)/.test(
        message,
      );
    reply.code(400).send({
      error: exposed
        ? message
        : 'Não foi possível concluir a operação. Confira os dados e tente novamente.',
    });
  });
  app.get('/api/health', async () => ({ ok: true }));
  await registerStudy(app, store);
  await registerChecklists(app, store);
  app.get('/api/dashboard', async () => {
    store.updateReminders();
    return store.dashboard();
  });
  app.get('/api/assessments/:id', async (request) =>
    store.detail(positive.parse((request.params as { id: string }).id)),
  );
  app.patch('/api/assessments/:id/deadline', async (request) => {
    const a = store.assessment(positive.parse((request.params as { id: string }).id));
    const input = z.object({ due_at: z.iso.datetime({ offset: true }) }).parse(request.body);
    store.setSetting(`due:${a.course_id}:${a.external_id}`, input.due_at);
    store.upsertAssessment({ ...a, due_at: input.due_at });
    store.db.prepare('DELETE FROM confirmations WHERE assessment_id=?').run(a.id);
    return store.detail(a.id);
  });
  app.get('/api/questions', async () =>
    store
      .dashboard()
      .assessments.flatMap((a) =>
        store
          .questions(a.id)
          .map((q) => ({ ...q, assessment_title: a.title, course_name: a.course_name })),
      ),
  );
  app.post('/api/questions/:id/answer', async (request) => {
    const id = positive.parse((request.params as { id: string }).id);
    const body = answerSchema.parse(request.body);
    return store.saveAnswer(id, body.answer, body.approve);
  });
  const generating = new Set<number>();
  app.post('/api/questions/:id/suggest', async (request) => {
    const id = positive.parse((request.params as { id: string }).id);
    const input = z
      .object({ provider: z.enum(['ollama', 'openai']), model: z.string().min(1).max(200) })
      .parse(request.body);
    if (generating.has(id)) throw new Error('Outra geração está em andamento para esta questão.');
    generating.add(id);
    try {
      return await suggest(store, id, input.provider, input.model);
    } finally {
      generating.delete(id);
    }
  });
  app.get('/api/ai/models', async () => models());
  app.get('/api/settings', async () => ({
    ollamaUrl: config.ollamaUrl,
    openaiConfigured: !!config.openaiKey,
    openaiModel: config.openaiModel,
    credentialsConfigured: !!config.username && !!config.password,
    timezone: 'America/Bahia',
    syncMinutes: 30,
    database: 'SQLite • armazenamento local',
  }));
  app.post('/api/materials', async (request) => {
    const input = z
      .object({
        course_id: positive,
        title: z.string().trim().min(1).max(300),
        content: z.string().trim().min(1).max(150000),
        url: z.string().max(2000).optional(),
      })
      .parse(request.body);
    store.addMaterial(input.course_id, input.title, input.content, input.url);
    return { ok: true };
  });
  app.patch('/api/materials/:id', async (request) => {
    const input = z.object({ selected: z.boolean() }).parse(request.body);
    store.db
      .prepare('UPDATE materials SET selected=? WHERE id=?')
      .run(Number(input.selected), positive.parse((request.params as { id: string }).id));
    return { ok: true };
  });
  app.post('/api/jobs', async (request) => {
    const input = z
      .object({
        kind: z.enum(['sync', 'inspect', 'extract', 'reconcile', 'fill', 'start']),
        assessment_id: positive.optional(),
        acknowledge: z.boolean().optional(),
        course_external_id: z
          .string()
          .regex(/^[1-9]\d{0,9}$/)
          .optional(),
      })
      .parse(request.body);
    if (input.kind !== 'sync' && !input.assessment_id) throw new z.ZodError([]);
    if (input.course_external_id && input.kind !== 'sync') throw new z.ZodError([]);
    if (['start', 'fill'].includes(input.kind) && !input.acknowledge) throw new z.ZodError([]);
    if (input.kind === 'fill') store.ensureReview(input.assessment_id!);
    const assessment = input.assessment_id ? store.assessment(input.assessment_id) : null;
    if (assessment?.external_id.startsWith('study:'))
      throw new Error('Avaliação de estudo local: responda manualmente no AVA.');
    const authorization =
      input.kind === 'start' && assessment
        ? {
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            rulesFingerprint: hash([
              assessment.instructions,
              assessment.duration_minutes,
              assessment.due_at,
            ]),
          }
        : input.course_external_id
          ? { courseExternalId: input.course_external_id }
          : {};
    const id = store.enqueue(input.kind, input.assessment_id || null, authorization);
    void queue?.tick();
    return store.job(id);
  });
  app.post('/api/assessments/:id/confirmation', async (request) =>
    store.confirmation(positive.parse((request.params as { id: string }).id)),
  );
  app.post('/api/assessments/:id/submit', async (request) => {
    const input = z.object({ token: z.string().length(64) }).parse(request.body);
    const id = store.enqueueSubmission(
      positive.parse((request.params as { id: string }).id),
      input.token,
    );
    void queue?.tick();
    return store.job(id);
  });
  app.post('/api/jobs/:id/retry', async (request) => {
    const job = store.job(positive.parse((request.params as { id: string }).id));
    if (
      !job ||
      !['needs_action', 'failed'].includes(job.status) ||
      !['sync', 'inspect', 'extract', 'reconcile'].includes(job.kind)
    )
      throw new z.ZodError([]);
    const id = store.enqueue(
      job.kind,
      job.assessment_id,
      job.kind === 'sync' ? store.jobPayload(job.id) : {},
    );
    void queue?.tick();
    return store.job(id);
  });
  app.post('/api/reminders/:id/ack', async (request) => {
    store.db
      .prepare('UPDATE reminders SET notified_at=? WHERE id=? AND notified_at IS NULL')
      .run(store.now(), positive.parse((request.params as { id: string }).id));
    return { ok: true };
  });
  app.get('/api/export', async (_request, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="focus-export.json"')
      .send(store.export()),
  );
  app.get('/api/assessments/:id/markdown', async (request, reply) =>
    reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="questoes.md"')
      .send(markdown(store.detail(positive.parse((request.params as { id: string }).id)))),
  );
  app.post('/api/backup', async () => ({ file: await backup(store, true) }));
  const web = path.resolve('dist/web');
  if (existsSync(web)) {
    await app.register(fastifyStatic, { root: web });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api')
        ? reply.code(404).send({ error: 'Rota não encontrada.' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
