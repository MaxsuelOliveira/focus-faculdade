import { PortalSession } from '../server/automation/session.js';
import { readCourse, readQuiz } from '../server/automation/ava.js';
import { config } from '../server/config.js';
const session = new PortalSession();
try {
  const page = await session.login();
  console.log('Login JACAD confirmado:', new URL(page.url()).pathname);
  console.log(
    'Página:',
    await page.title(),
    'frames:',
    page.frames().map((frame) => {
      try {
        const url = new URL(frame.url());
        return url.origin + url.pathname;
      } catch {
        return frame.url();
      }
    }),
  );
  console.log(
    'Links visíveis:',
    (await page.locator('a').allTextContents())
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25),
  );
  const ava = await page
    .locator('a')
    .filter({ hasText: /^\s*AVA\s*$/ })
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        tag: n.tagName,
        attributes: n.getAttributeNames(),
        href: n.getAttribute('href')?.split('?')[0],
      })),
    );
  console.log('Estrutura da entrada AVA:', JSON.stringify(ava));
  const coursePage = await session.ava();
  const course = await readCourse(coursePage);
  console.log(
    JSON.stringify(
      {
        course: course.external_id,
        name: course.name,
        quizzes: course.quizzes,
        courseCount: course.courses.length,
      },
      null,
      2,
    ),
  );
  if (course.quizzes[0]) {
    await coursePage.goto(course.quizzes[0].url, { waitUntil: 'domcontentloaded' });
    console.log('Regras da avaliação:', JSON.stringify(await readQuiz(coursePage), null, 2));
    console.log(
      'Datas estruturadas:',
      await coursePage
        .locator('.activity-dates, .quizinfo')
        .evaluateAll((nodes) => nodes.map((n) => n.outerHTML)),
    );
    console.log('Controles disponíveis:', await coursePage.getByRole('button').allTextContents());
  }
} catch (error) {
  let message = error instanceof Error ? error.message.split('\n')[0] : 'Inspeção pendente.';
  for (const secret of [config.username, config.password, config.openaiKey])
    if (secret) message = message.replaceAll(secret, '<oculto>');
  console.log('Inspeção pendente:', message);
  process.exitCode = 1;
} finally {
  await session.close();
}
