import type { Page } from 'playwright';
import type { Assessment, Answer } from '../../shared/types.js';
import type { QuestionInput } from '../db.js';
import { assertPortalUrl, assertReadable, NeedsAction } from './session.js';

export interface QuizInfo {
  title: string;
  instructions: string;
  due_at: string | null;
  source_timezone: string;
  duration_minutes: number | null;
  status: Assessment['status'];
  attempt_id: string | null;
}
export async function readCourse(page: Page) {
  await assertReadable(page);
  const url = new URL(page.url());
  const external_id = url.searchParams.get('id');
  if (url.pathname !== '/course/view.php' || !external_id)
    throw new NeedsAction('A disciplina esperada não foi aberta no AVA.');
  const title = await page.locator('h1').first().innerText();
  const quizzes = await page.locator('a[href*="/mod/quiz/view.php"]').evaluateAll((links) =>
    links.map((link) => ({
      title: (link.textContent || '').trim(),
      url: (link as HTMLAnchorElement).href,
    })),
  );
  const courses = await page.locator('a[href*="/course/view.php?id="]').evaluateAll((links) =>
    links.map((link) => ({
      name: (link.textContent || '').trim(),
      url: (link as HTMLAnchorElement).href,
    })),
  );
  const materials = await page
    .locator('a[href*="/mod/page/view.php"], a[href*="/mod/book/view.php"]')
    .evaluateAll((links) =>
      links.map((link) => ({
        title: (link.textContent || '').trim(),
        url: (link as HTMLAnchorElement).href,
      })),
    );
  return {
    external_id,
    name: title.trim(),
    url: url.href,
    quizzes: [...new Map(quizzes.map((q) => [q.url, q])).values()],
    courses: [...new Map(courses.map((c) => [c.url, c])).values()],
    materials: [...new Map(materials.map((m) => [m.url, m])).values()],
  };
}

export async function readQuiz(page: Page): Promise<QuizInfo> {
  await assertReadable(page);
  if (!page.url().includes('/mod/quiz/'))
    throw new NeedsAction('Página de avaliação não reconhecida.');
  const title = await page.locator('h1').first().innerText();
  const intro = page.locator(
    '#intro, .quizinfo, .quizattemptsummary, .quizattempt, .activity-dates',
  );
  const instructions = (await intro.allTextContents()).join('\n').trim();
  const closeElement = page.locator('[data-timeclose]').first();
  const machineClose = (await closeElement.count())
    ? await closeElement.getAttribute('data-timeclose')
    : null;
  const timeElement = page.locator('.activity-dates time[datetime]').last();
  const closingTime = (await timeElement.count())
    ? await timeElement.getAttribute('datetime')
    : null;
  // Datas sem fuso ou sem semântica clara não são convertidas por adivinhação.
  let due_at: string | null = null;
  if (machineClose && Number(machineClose) > 0)
    due_at = new Date(Number(machineClose) * 1000).toISOString();
  else if (closingTime && /(?:Z|[+-]\d{2}:?\d{2})$/.test(closingTime))
    due_at = new Date(closingTime).toISOString();
  const resume = page.locator('a[href*="/mod/quiz/attempt.php?attempt="]');
  const href = (await resume.count()) ? await resume.first().getAttribute('href') : null;
  const attempt_id = href ? new URL(href, page.url()).searchParams.get('attempt') : null;
  const submitted = await page
    .locator('.generaltable.quizattemptsummary tr')
    .filter({ hasText: /Finalizada|Finished|Enviado|Submitted/i })
    .count();
  const start = await page
    .getByRole('button', {
      name: /Tentar responder|Responder.*questionário|Tentativa do questionário|Attempt quiz|Iniciar tentativa/i,
    })
    .count();
  const duration = instructions.match(
    /(?:Limite de tempo|Duração máxima|Time limit)\s*:?\s*(\d+)\s*(minuto|minute|hora|hour)/i,
  );
  return {
    title: title.trim(),
    instructions,
    due_at,
    source_timezone: closingTime?.match(/([+-]\d{2}:?\d{2}|Z)$/)?.[1] || 'America/Bahia',
    duration_minutes: duration
      ? Number(duration[1]) * (/hora|hour/i.test(duration[2]) ? 60 : 1)
      : null,
    status: attempt_id
      ? 'in_progress'
      : submitted
        ? 'submitted'
        : due_at && Date.parse(due_at) <= Date.now()
          ? 'closed'
          : start
            ? 'available'
            : 'unknown',
    attempt_id,
  };
}

export async function readQuestionPage(page: Page): Promise<QuestionInput[]> {
  await assertReadable(page);
  return page.locator('.que').evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const promptEl = node.querySelector('.qtext');
      const prompt = (promptEl?.textContent || '').trim();
      const inputNodes = Array.from(
        node.querySelectorAll<HTMLInputElement>(
          '.answer input[type=radio], .answer input[type=checkbox]',
        ),
      );
      const choices = inputNodes.map((input) => ({
        id: input.type === 'checkbox' ? `${input.name}::${input.value}` : input.value,
        text: (
          input.labels?.[0]?.textContent ||
          input.closest('.r0,.r1,div')?.textContent ||
          ''
        ).trim(),
      }));
      const textarea = node.querySelector('textarea[name$="_answer"], textarea[name*="_answer"]');
      const unsupported =
        node.matches('.match,.ddwtos,.ddimageortext,.calculated,.numerical,.multianswer') ||
        !prompt ||
        !!node.querySelector('iframe, .answer input[type=file]');
      const type = unsupported
        ? 'unsupported'
        : inputNodes.length
          ? inputNodes[0].type === 'checkbox'
            ? 'multiple'
            : 'single'
          : textarea
            ? 'text'
            : 'unsupported';
      const number = Number(node.querySelector('.qno')?.textContent) || index + 1;
      return {
        external_id: node.id,
        position: number,
        type,
        prompt,
        choices,
        images: Array.from(node.querySelectorAll<HTMLImageElement>('.qtext img')).map(
          (img) => img.src,
        ),
      };
    }),
  );
}

export async function attemptPages(page: Page) {
  const links = await page
    .locator('#mod_quiz_navblock a[href*="attempt.php"], .qn_buttons a[href*="attempt.php"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
  const current = new URL(page.url());
  if (!current.searchParams.get('attempt')) throw new NeedsAction('Tentativa não identificada.');
  const seen = new Map<string, string>();
  for (const link of [page.url(), ...links]) {
    const parsed = new URL(assertPortalUrl(link));
    if (parsed.searchParams.get('attempt') !== current.searchParams.get('attempt'))
      throw new NeedsAction('Navegação aponta para outra tentativa.');
    parsed.hash = '';
    seen.set(parsed.searchParams.get('page') || '0', parsed.href);
  }
  return [...seen.values()];
}

export async function openAttempt(page: Page, assessment: Assessment) {
  await page.goto(assertPortalUrl(assessment.url), { waitUntil: 'domcontentloaded' });
  const info = await readQuiz(page);
  if (!info.attempt_id)
    throw new NeedsAction(
      'Não há tentativa aberta. Consulte as regras e use Iniciar tentativa no painel.',
    );
  if (assessment.attempt_id && info.attempt_id !== assessment.attempt_id)
    throw new NeedsAction('A tentativa mudou. Extraia novamente e revise as respostas.');
  await page.goto(
    `https://graduacao.faculdadefocus.edu.br/mod/quiz/attempt.php?attempt=${encodeURIComponent(info.attempt_id)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await assertReadable(page);
  return info;
}

export async function collectAttempt(page: Page) {
  const pages = await attemptPages(page);
  const questions: QuestionInput[] = [];
  for (const url of pages) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    questions.push(...(await readQuestionPage(page)));
  }
  if (!questions.length || questions.some((q) => !q.external_id))
    throw new NeedsAction('Não foi possível identificar as questões desta tentativa.');
  return [...new Map(questions.map((q) => [q.external_id, q])).values()].sort(
    (a, b) => a.position - b.position,
  );
}

export async function fillQuestion(page: Page, question: QuestionInput, answer: Answer) {
  const root = page.locator(`[id=${JSON.stringify(question.external_id)}]`);
  if (question.type === 'text') {
    const textarea = root.locator('textarea[name*="_answer"]');
    const editor = root.locator('[contenteditable=true]');
    if (await editor.count())
      throw new NeedsAction('Editor rico exige preenchimento manual para evitar divergências.');
    await textarea.fill(answer.text);
  } else if (question.type === 'single' || question.type === 'multiple') {
    const inputs = root.locator('.answer input[type=radio], .answer input[type=checkbox]');
    for (const input of await inputs.all()) {
      const value = await input.getAttribute('value');
      if (!value) throw new NeedsAction('Alternativa não identificada.');
      const identity =
        question.type === 'multiple' ? `${await input.getAttribute('name')}::${value}` : value;
      const checked = answer.choices.includes(identity);
      if (question.type === 'multiple') await input.setChecked(checked);
      else if (checked) await input.check();
    }
  } else throw new NeedsAction('Questão não suportada exige intervenção manual.');
}

export async function verifyFilled(page: Page, question: QuestionInput, answer: Answer) {
  const root = page.locator(`[id=${JSON.stringify(question.external_id)}]`);
  if (question.type === 'text')
    return (await root.locator('textarea[name*="_answer"]').inputValue()) === answer.text;
  const selected = await root.locator('.answer input:checked').evaluateAll((nodes) =>
    nodes
      .map((el) => {
        const input = el as HTMLInputElement;
        return input.type === 'checkbox' ? `${input.name}::${input.value}` : input.value;
      })
      .sort(),
  );
  return JSON.stringify(selected) === JSON.stringify([...answer.choices].sort());
}
