import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from './db.js';
import { studyMarkdown } from '../shared/study.js';

export const questionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(30000),
    type: z.enum(['single', 'multiple', 'text']),
    choices: z
      .array(z.object({ id: z.string().min(1).max(30), text: z.string().trim().min(1).max(10000) }))
      .max(30),
  })
  .refine((q) =>
    q.type === 'text'
      ? !q.choices.length
      : q.choices.length >= 2 && new Set(q.choices.map((c) => c.id)).size === q.choices.length,
  );

export async function registerStudy(app: FastifyInstance, store: Store) {
  app.get('/api/study/sets', async () =>
    store.db
      .prepare(
        `
    SELECT a.*,c.name course_name, count(q.id) question_count,
    sum(CASE WHEN q.suggestion IS NOT NULL OR q.answer!='{"text":"","choices":[]}' THEN 1 ELSE 0 END) answered_count
    FROM assessments a JOIN courses c ON c.id=a.course_id LEFT JOIN questions q ON q.assessment_id=a.id
    GROUP BY a.id HAVING a.external_id LIKE 'study:%' OR count(q.id)>0 ORDER BY a.id DESC
  `,
      )
      .all(),
  );
  app.post('/api/study/sets', async (request) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(300),
        course_id: z.number().int().positive().optional(),
        course_name: z.string().trim().min(1).max(300).optional(),
        questions: z.array(questionSchema).min(1).max(50),
      })
      .parse(request.body);
    return store.db.transaction(() => {
      let courseId = body.course_id;
      if (courseId && !store.db.prepare('SELECT id FROM courses WHERE id=?').get(courseId))
        throw new Error('Selecione uma disciplina existente.');
      if (!courseId) {
        const name = body.course_name || 'Meus estudos';
        const existing = store.db
          .prepare('SELECT id FROM courses WHERE name=? AND external_id LIKE ?')
          .get(name, 'study:%') as { id: number } | undefined;
        courseId =
          existing?.id || store.course({ external_id: `study:${randomUUID()}`, name, url: '' }).id;
      }
      const assessment = store.upsertAssessment({
        external_id: `study:${randomUUID()}`,
        course_id: courseId,
        title: body.title,
        url: '',
        status: 'unknown',
        instructions: 'Gabarito pessoal para estudo. Responda manualmente no AVA.',
      });
      store.replaceQuestions(
        assessment.id,
        body.questions.map((q, index) => ({
          ...q,
          external_id: `study:${randomUUID()}`,
          position: index + 1,
          images: [],
        })),
        null,
      );
      return store.detail(assessment.id);
    })();
  });
  app.get('/api/study/:id/markdown', async (request, reply) =>
    reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="gabarito.md"')
      .send(
        studyMarkdown(
          store.detail(
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
