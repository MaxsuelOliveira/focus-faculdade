import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './db.js';
import { ChecklistConflict, ChecklistStore, checklistMarkdown } from './checklist-store.js';
export async function registerChecklists(app: FastifyInstance, store: Store) {
  const checklists = new ChecklistStore(store.db);
  app.get('/api/checklists', async () => checklists.plans());
  app.get('/api/checklists/:id', async (request) =>
    checklists.detail(
      z.coerce
        .number()
        .int()
        .positive()
        .parse((request.params as { id: string }).id),
    ),
  );
  app.patch('/api/checklist-items/:id', async (request, reply) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((request.params as { id: string }).id);
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        done: z.boolean().optional(),
        notes: z.string().max(5000).optional(),
      })
      .refine((body) => body.done !== undefined || body.notes !== undefined)
      .parse(request.body);
    try {
      return checklists.patch(id, body);
    } catch (error) {
      if (error instanceof ChecklistConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
  app.get('/api/checklists/:id/markdown', async (request, reply) =>
    reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="checklist-pi-iii.md"')
      .send(
        checklistMarkdown(
          checklists.detail(
            z.coerce
              .number()
              .int()
              .positive()
              .parse((request.params as { id: string }).id),
          ),
        ),
      ),
  );
}
