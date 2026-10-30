import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto('http://127.0.0.1:4317');
  await page.getByRole('button', { name: 'Gabaritos com IA', exact: true }).click();
  await page.getByRole('button', { name: /Simulado de exemplo — IA local/ }).click();
  await page.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('qwen3:4b');
  await page.getByRole('button', { name: 'Gerar outra resposta' }).first().click();
  await page
    .getByText('1 resposta(s) salva(s) no gabarito.', { exact: true })
    .waitFor({ timeout: 200000 });
  const selected = await page.locator('.study-option.correct').first().innerText();
  if (!selected.includes('GET'))
    throw new Error('A resposta do exemplo não corresponde ao material de apoio.');
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/study-key-real.png', fullPage: true });
  console.log(
    'Geração real pelo painel e API local concluída com qwen3:4b; resposta GET salva no gabarito.',
  );
} finally {
  await browser.close();
}
