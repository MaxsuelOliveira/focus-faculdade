import { test, expect } from '@playwright/test';
import { chromium, type BrowserContext } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../../server/db.js';
import { PortalRunner } from '../../server/automation/runner.js';
import { PortalSession } from '../../server/automation/session.js';
import { readQuestionPage, readQuiz } from '../../server/automation/ava.js';
import { JobQueue } from '../../server/automation/queue.js';

test('gabarito com questões coladas e respostas da IA salvas para uso manual', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Gabaritos com IA', exact: true }).click();
  await page.getByRole('button', { name: 'Novo gabarito' }).click();
  await page
    .getByRole('textbox', { name: 'Nome do gabarito' })
    .fill('Simulado — Gabarito de teste');
  await page.getByRole('textbox', { name: 'Nome da disciplina, se for outra' }).fill('Programação');
  await page
    .getByRole('textbox', { name: 'Perguntas e alternativas' })
    .fill(
      'Qual método HTTP consulta dados?\nA) GET\nB) DELETE\n---\nExplique o que é uma variável.',
    );
  await expect(page.getByText('2 questão(ões) identificada(s)')).toBeVisible();
  await page.getByRole('button', { name: 'Criar gabarito', exact: true }).click();
  await page.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('study-test');
  await page.getByRole('button', { name: 'Responder questões pendentes' }).click();
  await expect(page.getByText('2 resposta(s) salva(s) no gabarito.')).toBeVisible();
  await expect(page.getByText('Por que essa resposta?', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Copiar gabarito', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '**Resposta:** A) GET',
  );
  await page.getByRole('button', { name: 'Usar no meu gabarito' }).first().click();
  await expect(page.getByText('Meu gabarito', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Gabaritos com IA', exact: true }).click();
  await page.getByRole('button', { name: /Simulado — Gabarito de teste/ }).click();
  await expect(page.getByText('Por que essa resposta?', { exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 375, height: 850 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/playwright/study-key-mobile.png', fullPage: true });
});

test('painel desktop e celular, filtros, cópia, revisão e confirmação', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /vamos estudar/ })).toBeVisible();
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Avaliações', exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'output/playwright/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Avaliações', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar avaliações' }).fill('não existe');
  await expect(page.getByRole('heading', { name: 'Nenhuma avaliação encontrada' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar avaliações' }).fill('');
  await page.getByRole('button', { name: /Avaliação de aprendizagem/ }).click();
  await page.getByRole('button', { name: 'Copiar questão', exact: true }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'revisão bibliográfica',
  );
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Aprovar resposta' }).first().click();
  await expect(page.getByText('Aprovada', { exact: true })).toHaveCount(1);
  await page
    .getByRole('textbox', { name: 'Sua resposta' })
    .fill('Referências atribuem as ideias e permitem consultar as fontes.');
  await page.getByRole('button', { name: 'Aprovar resposta' }).nth(1).click();
  await expect(page.getByText('Aprovada', { exact: true })).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: 'Avaliações', exact: true }).click();
  await page.getByRole('button', { name: /Avaliação de aprendizagem/ }).click();
  await expect(page.getByRole('textbox', { name: 'Sua resposta' })).toHaveValue(
    /Referências atribuem/,
  );
  await page.getByRole('button', { name: 'Revisar entrega' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmar entrega da avaliação' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar revisando' }).click();
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Revisar entrega' })).toBeDisabled();
  await page.setViewportSize({ width: 375, height: 850 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/playwright/assessment-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Adicionar material' }).click();
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 375 / 2)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
});

for (const scenario of ['success', 'changed', 'missing-receipt'] as const)
  test(`adaptador AVA: ${scenario}`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'focus-portal-'));
    const store = new Store(directory);
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    let submitted = false;
    let saved = '';
    let submitCount = 0;
    let changed = false;
    const closes = Math.floor(Date.now() / 1000) + 3600;
    await context.route('https://graduacao.faculdadefocus.edu.br/**', async (route) => {
      const url = new URL(route.request().url());
      let body: string;
      if (url.pathname.endsWith('/view.php'))
        body = `<h1>Avaliação simulada</h1><div class="quizinfo" data-timeclose="${closes}">Limite de tempo: 60 minutos</div>${submitted ? '<table class="generaltable quizattemptsummary"><tr><td>Finalizada</td></tr></table>' : '<a href="/mod/quiz/attempt.php?attempt=42">Continuar tentativa</a>'}`;
      else if (url.pathname.endsWith('/attempt.php'))
        body = `<h1>Avaliação simulada</h1><form action="/mod/quiz/save.php"><div class="que multichoice" id="question-42-1"><span class="qno">1</span><div class="qtext">${changed ? 'Quanto é 3 + 3?' : 'Quanto é 2 + 2?'}</div><div class="answer"><label><input type="radio" name="answer" value="0" ${saved === '0' ? 'checked' : ''}>3</label><label><input type="radio" name="answer" value="1" ${saved === '1' ? 'checked' : ''}>4</label></div></div><button name="next">Finalizar tentativa</button></form>`;
      else if (url.pathname.endsWith('/save.php')) {
        saved = url.searchParams.get('answer') || '';
        body = '<h1>Resumo</h1>';
      } else if (url.pathname.endsWith('/summary.php'))
        body =
          '<h1>Resumo</h1><form action="/mod/quiz/finish.php"><button>Enviar tudo e terminar</button></form>';
      else if (url.pathname.endsWith('/finish.php')) {
        submitted = true;
        submitCount++;
        body = '<script>location.href="/mod/quiz/review.php?attempt=42"</script>';
      } else
        body =
          scenario === 'missing-receipt'
            ? '<h1>Resposta sem comprovante</h1>'
            : '<h1>Revisão</h1><table class="quizreviewsummary"><tr><td>Estado</td><td>Finalizada</td></tr></table>';
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    class SimulatedSession extends PortalSession {
      override async ava() {
        return page;
      }
      override async close() {}
    }
    try {
      const course = store.course({
        external_id: 'sim',
        name: 'Simulação',
        url: 'https://graduacao.faculdadefocus.edu.br/course/view.php?id=8683',
      });
      const a = store.upsertAssessment({
        external_id: '1',
        course_id: course.id,
        title: 'Avaliação simulada',
        url: 'https://graduacao.faculdadefocus.edu.br/mod/quiz/view.php?id=1',
        status: 'in_progress',
        attempt_id: '42',
      });
      const runner = new PortalRunner(store);
      runner.session = new SimulatedSession();
      const queue = new JobQueue(store, (job) => runner.execute(job));
      const extract = store.enqueue('extract', a.id);
      await queue.tick();
      expect(store.job(extract).status).toBe('completed');
      const q = store.questions(a.id)[0];
      expect(q.choices).toHaveLength(2);
      store.saveAnswer(q.id, { text: '', choices: ['1'] }, true);
      const c = store.confirmation(a.id);
      const submit = store.enqueueSubmission(a.id, c.token);
      if (scenario === 'changed') changed = true;
      await queue.tick();
      expect(store.job(submit).status, store.job(submit).progress).toBe(
        scenario === 'success' ? 'completed' : 'uncertain',
      );
      if (scenario === 'changed') {
        expect(submitCount).toBe(0);
        expect(store.question(q.id).approved_hash).toBeNull();
        expect(store.export().questionHistory).toHaveLength(1);
      } else {
        expect(saved).toBe('1');
        expect(submitCount).toBe(1);
        if (scenario === 'success') {
          expect(store.assessment(a.id).status).toBe('submitted');
          expect(store.detail(a.id).receipts[0].evidence).toContain('Finalizada');
        } else {
          expect(store.detail(a.id).receipts).toHaveLength(0);
          expect(() => store.enqueue('submit', a.id)).toThrow(/incerto/);
        }
      }
      expect(() => store.enqueueSubmission(a.id, c.token)).toThrow();
    } finally {
      await browser.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('adaptadores pausam com sessão expirada e detectam formatos especiais', async ({ page }) => {
  await page.route('https://graduacao.faculdadefocus.edu.br/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Acesso</h1><input type="password">' }),
  );
  await page.goto('https://graduacao.faculdadefocus.edu.br/mod/quiz/view.php?id=1');
  await expect(readQuiz(page)).rejects.toThrow(/sessão expirou/);
  await page.unrouteAll();
  await page.route('https://graduacao.faculdadefocus.edu.br/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div class="que match" id="q-1"><span class="qno">1</span><div class="qtext">Associe os itens.</div></div>',
    }),
  );
  await page.reload();
  expect((await readQuestionPage(page))[0].type).toBe('unsupported');
  await page.unrouteAll();
  await page.route('https://graduacao.faculdadefocus.edu.br/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Prova</h1><div class="quizinfo" data-timeclose="1"></div>',
    }),
  );
  await page.reload();
  expect((await readQuiz(page)).due_at).toBe('1970-01-01T00:00:01.000Z');
});

// Mantém o tipo do navegador explícito nos fixtures sem depender de estado real.
export type SimulationContext = BrowserContext;
