import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createServer } from 'node:http';
import { ChecklistStore } from '../server/checklist-store.js';
import { piIiiAdsPlan } from '../server/plans/pi-iii-ads.js';
const aiFixture = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/tags') {
    response.end(JSON.stringify({ models: [{ name: 'study-test' }] }));
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const input = JSON.parse(body.messages[1].content);
  response.end(
    JSON.stringify({
      message: {
        content: JSON.stringify({
          answer: {
            text:
              input.question.type === 'text'
                ? 'Uma variável guarda um valor que pode ser consultado no programa.'
                : '',
            choices: input.question.type === 'text' ? [] : [input.question.choices[0].id],
          },
          explanation: 'Explicação simulada para testar o gabarito.',
          references: [],
        }),
      },
    }),
  );
});
aiFixture.listen(11435, '127.0.0.1');
const store = new Store(mkdtempSync(path.join(tmpdir(), 'focus-ui-')));
new ChecklistStore(store.db).seed(piIiiAdsPlan);
const course = store.course({
  external_id: 'simulation',
  name: 'Metodologia Científica · Simulação',
  url: 'https://graduacao.faculdadefocus.edu.br/course/view.php?id=8683',
});
const a = store.upsertAssessment({
  external_id: 'sim-quiz',
  course_id: course.id,
  title: 'Avaliação de aprendizagem · Simulação',
  url: 'https://graduacao.faculdadefocus.edu.br/mod/quiz/view.php?id=1',
  status: 'in_progress',
  attempt_id: '42',
  due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
  duration_minutes: 60,
  instructions: 'Ambiente simulado. Nenhuma ação será enviada à faculdade.',
});
store.replaceQuestions(
  a.id,
  [
    {
      external_id: 'q-sim-1',
      position: 1,
      type: 'single',
      prompt: 'Qual é o objetivo de uma revisão bibliográfica?',
      choices: [
        { id: 'a', text: 'Reunir e analisar o conhecimento já publicado sobre um tema.' },
        { id: 'b', text: 'Substituir a investigação por uma opinião pessoal.' },
      ],
      images: [],
    },
    {
      external_id: 'q-sim-2',
      position: 2,
      type: 'text',
      prompt: 'Explique a importância das referências em um trabalho acadêmico.',
      choices: [],
      images: [],
    },
  ],
  '42',
);
store.addMaterial(
  course.id,
  'Unidade 1 · Material simulado',
  'Referências permitem atribuir ideias e consultar as fontes de uma pesquisa.',
);
const app = await createApp(store);
await app.listen({ host: '127.0.0.1', port: 4317 });
