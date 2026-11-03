import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db.js';
import { PortalStore } from './store.js';
import { portalOpenApi } from './openapi.js';

export async function registerPortal(app: FastifyInstance, store: Store) {
  const portal = new PortalStore(store);
  app.get('/api/portal/openapi', async () => portalOpenApi);
  app.get('/api/portal/status', async () => portal.status());
  app.get('/api/portal/courses', async () => portal.courses());
  app.get('/api/portal/assessments/:id', async (request) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((request.params as { id: string }).id);
    const detail = store.detail(id);
    return {
      ...detail,
      assessment: portal.projectAssessment(detail.assessment),
      api: portal.assessmentFacts(detail.assessment),
      capabilities: portal.status().capabilities,
      questionSource: 'local_extraction_or_study',
    };
  });
  app.get('/api/portal/calendar', async (request) => {
    const { from, to } = z
      .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
      .parse(request.query);
    if (Date.parse(from) > Date.parse(to)) throw new z.ZodError([]);
    return portal.calendar(from, to);
  });
  app.get('/api/portal/export', async (_request, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="focus-portal-api.json"')
      .send({ ...portal.courses(), events: portal.allEvents() }),
  );
}
