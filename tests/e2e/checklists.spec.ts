import { test, expect } from '@playwright/test';
test('checklist da disciplina: fontes, prazos, progresso, notas e persistência em celular', async ({
  page,
}) => {
  await page.goto('/?view=checklists');
  await expect(page.getByRole('heading', { name: 'Meu checklist', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Projeto Interdisciplinar III — checklist de conclusão',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Meta pessoal: concluir em 30/10 até 23h59.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/1 tentativa e duração máxima de 1 hora/)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(34);
  const check = page.getByRole('checkbox', {
    name: 'Ler o manual completo do PI III',
    exact: true,
  });
  await check.check();
  await expect(page.getByRole('progressbar', { name: 'Exigências concluídas' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );
  const card = page.locator('.checklist-task').first();
  await card.getByText('Adicionar anotações e links', { exact: true }).click();
  await card.getByRole('textbox').fill('Revisar meus diagramas antes de exportar o PDF.');
  await card.getByRole('button', { name: 'Salvar anotações' }).click();
  await expect(card.getByText('Anotações salvas.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: 'Ler o manual completo do PI III', exact: true }),
  ).toBeChecked();
  const saved = page.locator('.checklist-task').first();
  await saved.getByText('Minhas anotações salvas', { exact: true }).click();
  await expect(saved.getByRole('textbox')).toHaveValue(
    'Revisar meus diagramas antes de exportar o PDF.',
  );
  await page.getByRole('combobox', { name: 'Filtrar tarefas do checklist' }).selectOption('done');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page
    .getByRole('combobox', { name: 'Filtrar tarefas do checklist' })
    .selectOption('pending');
  await expect(page.getByRole('checkbox')).toHaveCount(33);
  await page.getByRole('combobox', { name: 'Filtrar tarefas do checklist' }).selectOption('all');
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Meu checklist', exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'output/playwright/checklist-mobile.png', fullPage: true });
  const markdown = await page.request.get('/api/checklists/1/markdown');
  expect(markdown.status()).toBe(200);
  expect(await markdown.text()).toContain('Revisar meus diagramas');
  await expect(page.getByRole('link', { name: 'Abrir entrega no AVA' })).toHaveAttribute(
    'href',
    /id=104945/,
  );
});
