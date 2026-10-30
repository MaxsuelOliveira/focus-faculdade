import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { PortalSession, assertPortalUrl, assertReadable } from '../server/automation/session.js';
import { collectAttempt, openAttempt, readCourse, readQuiz } from '../server/automation/ava.js';

const [courseId, quizId] = process.argv.slice(2);
if (![courseId, quizId].every((value) => /^\d+$/.test(value || ''))) {
  throw new Error('Informe os IDs numéricos de curso e avaliação.');
}
// Independent profile: do not contend with the running application's browser.
const session = new PortalSession(path.join(config.dataDir, 'browser-inspection'));
try {
  const page = await session.ava();
  await page.goto(
    assertPortalUrl(`https://graduacao.faculdadefocus.edu.br/course/view.php?id=${courseId}`),
    { waitUntil: 'domcontentloaded' },
  );
  const course = await readCourse(page);
  const quizUrl = `https://graduacao.faculdadefocus.edu.br/mod/quiz/view.php?id=${quizId}`;
  if (!course.quizzes.some((quiz) => new URL(quiz.url).searchParams.get('id') === quizId))
    throw new Error('Avaliação não vinculada ao curso.');
  await page.goto(assertPortalUrl(quizUrl), { waitUntil: 'domcontentloaded' });
  await assertReadable(page);
  const quiz = await readQuiz(page);
  const text = await page.locator('#region-main').innerText();
  const reviewLinks = await page
    .locator('#region-main a[href*="/mod/quiz/review.php"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        title: node.textContent?.trim(),
        url: (node as HTMLAnchorElement).href,
      })),
    );
  let questions: unknown[] = [];
  if (quiz.attempt_id) {
    await openAttempt(page, {
      ...quiz,
      id: 0,
      external_id: quizId,
      course_id: 0,
      url: quizUrl,
      updated_at: '',
      fingerprint: null,
    });
    questions = await collectAttempt(page);
  }
  const directory = path.join(config.dataDir, 'assessments', quizId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'inspection.json'),
    JSON.stringify(
      { course, quiz, text, questions, reviewLinks, inspectedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        course: course.name,
        quiz,
        text,
        questionCount: questions.length,
        reviewLinks,
        saved: `data/assessments/${quizId}/inspection.json`,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    'Consulta não concluída. Confira o navegador e a configuração local; dados de login não são registrados.',
  );
  process.exitCode = 1;
} finally {
  await session.close();
}
