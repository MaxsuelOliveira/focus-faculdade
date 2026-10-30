import { Store } from '../server/db.js';
import { config } from '../server/config.js';
import { suggest } from '../server/ai.js';
import { backup } from '../server/backup.js';
const store = new Store(config.dataDir);
try {
  await backup(store, true);
  const course = store.course({
    external_id: 'study:live-example-course',
    name: 'Programação — exemplo de estudo',
    url: '',
  });
  const a = store.upsertAssessment({
    external_id: 'study:live-example',
    course_id: course.id,
    title: 'Simulado de exemplo — IA local',
    url: '',
    instructions: 'Exemplo de estudo respondido pela IA local. Não é uma avaliação enviada ao AVA.',
  });
  store.replaceQuestions(
    a.id,
    [
      {
        external_id: 'study:example-http',
        position: 1,
        type: 'single',
        prompt:
          'Qual método HTTP é apropriado para consultar um recurso sem solicitar alteração no servidor?',
        choices: [
          { id: 'A', text: 'GET' },
          { id: 'B', text: 'DELETE' },
          { id: 'C', text: 'POST' },
        ],
        images: [],
      },
      {
        external_id: 'study:example-js',
        position: 2,
        type: 'text',
        prompt: 'Explique a diferença entre let e const no JavaScript e dê um exemplo curto.',
        choices: [],
        images: [],
      },
    ],
    null,
  );
  store.upsertMaterial(
    course.id,
    'Conceitos básicos do exemplo',
    'O método HTTP GET consulta a representação de um recurso. Em JavaScript, let permite reatribuição. const cria uma vinculação que não pode ser reatribuída; objetos associados a const ainda podem ter suas propriedades modificadas.',
    'local:conceitos-basicos',
  );
  for (const q of store.questions(a.id)) {
    console.log(`Gerando resposta local para questão ${q.position}…`);
    const result = await suggest(store, q.id, 'ollama', process.argv[2] || 'qwen3:4b');
    console.log(
      JSON.stringify({
        question: q.position,
        answer: result.answer,
        explanation: result.explanation,
        model: result.model,
      }),
    );
  }
  console.log(`Gabarito de exemplo salvo: ${a.id}. Nenhuma interação com prova no AVA.`);
} finally {
  store.close();
}
