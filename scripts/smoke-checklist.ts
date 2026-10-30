import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import type { ChecklistPlan } from '../shared/checklists.js';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto('http://127.0.0.1:4317/?view=checklists');
  await page
    .getByRole('heading', {
      name: 'Projeto Interdisciplinar III — checklist de conclusão',
      exact: true,
    })
    .waitFor();
  const plans = (await (
    await page.request.get('http://127.0.0.1:4317/api/checklists')
  ).json()) as ChecklistPlan[];
  const plan = plans.find((plan) => plan.external_id === 'focus:assign:104945');
  if (!plan || plan.items.length !== 34 || (await page.getByRole('checkbox').count()) !== 34)
    throw new Error('Plano não corresponde aos requisitos revisados.');
  if (
    plan.personal_due_at !== '2026-10-30T23:59:00-03:00' ||
    plan.official_due_at !== '2026-10-31T23:59:00-03:00'
  )
    throw new Error('Prazos divergentes.');
  await page.evaluate(() => document.fonts.ready);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/checklist-real-desktop.png' });
  await page.locator('.checklist-phase').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/checklist-real-tasks.png' });
  await page.setViewportSize({ width: 375, height: 850 });
  await page.locator('.checklist-phase').first().scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw new Error('Overflow no checklist móvel.');
  await page.screenshot({ path: 'output/playwright/checklist-real-mobile.png' });
  console.log(
    JSON.stringify(
      {
        checklist: plan.title,
        tasks: plan.items.length,
        required: plan.items.filter((item) => item.required).length,
        markedByUser: plan.items.filter((item) => item.done).length,
        verified:
          'Build servido com o banco real, desktop e celular; sem alterar marcações nem atividades do AVA.',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
