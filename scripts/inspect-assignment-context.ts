import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PortalSession, assertReadable } from '../server/automation/session.js';
import { config } from '../server/config.js';
const session = new PortalSession();
try {
  const page = await session.ava();
  const pages = [];
  for (const url of [
    'https://graduacao.faculdadefocus.edu.br/course/view.php?id=6618',
    'https://graduacao.faculdadefocus.edu.br/mod/quiz/view.php?id=104946&forceview=1',
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await assertReadable(page);
    const title = await page.locator('h1').first().innerText();
    const text = await page.locator('#region-main').innerText();
    const record = { url: page.url(), title, text, inspectedAt: new Date().toISOString() };
    pages.push(record);
    console.log(JSON.stringify(record, null, 2));
  }
  await writeFile(
    path.join(config.dataDir, 'assignments/104945/context.json'),
    JSON.stringify(pages, null, 2),
  );
} finally {
  await session.close();
}
