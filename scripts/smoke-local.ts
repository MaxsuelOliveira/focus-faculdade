import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', () => errors.push('Erro de execução no frontend'));
try {
  await page.goto('http://127.0.0.1:4317');
  await page.getByRole('heading', { name: /vamos estudar/ }).waitFor();
  await page.getByText('Carregando seu espaço…', { exact: true }).waitFor({ state: 'hidden' });
  await page.evaluate(() => document.fonts.ready);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/dashboard-real-local.png', fullPage: true });
  await page.getByRole('button', { name: 'Avaliações', exact: true }).click();
  await page
    .getByRole('button', { name: /Avaliação da Disciplina/ })
    .first()
    .click();
  await page.getByRole('heading', { name: 'Avaliação da Disciplina', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/assessment-real-local.png', fullPage: true });
  if (errors.length) throw new Error('A interface registrou erro de execução.');
  console.log(
    'Painel e avaliação reais renderizados pelo build local. Nenhuma ação de prova executada.',
  );
} finally {
  await browser.close();
}
