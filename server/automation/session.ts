import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import { config } from '../config.js';
import { avaEntry } from './jacad.js';

export class NeedsAction extends Error {}
export const portalHosts = new Set([
  'faculdadefocus.jacad.com.br',
  'graduacao.faculdadefocus.edu.br',
]);
export function assertPortalUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    !portalHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error('Endereço fora dos portais autorizados.');
  return url.href;
}
export async function assertReadable(page: Page) {
  const url = new URL(page.url());
  if (!portalHosts.has(url.hostname))
    throw new NeedsAction('Navegação fora do portal esperado. Confira o navegador.');
  const password = page.locator('input[type=password]:visible');
  if (await password.count())
    throw new NeedsAction(
      'A sessão expirou ou o AVA exige outro login. Conclua o acesso no navegador e tente novamente.',
    );
  if (
    await page
      .locator(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[autocomplete="one-time-code"]:visible',
      )
      .count()
  )
    throw new NeedsAction('Conclua a verificação de acesso no navegador e retome a operação.');
}

export class PortalSession {
  constructor(private profileDirectory = path.join(config.dataDir, 'browser')) {}
  context?: BrowserContext;
  page?: Page;
  async open() {
    if (this.context && this.page && !this.page.isClosed()) return this.page;
    this.context = await chromium.launchPersistentContext(this.profileDirectory, {
      headless: false,
      viewport: { width: 1366, height: 900 },
      acceptDownloads: false,
    });
    this.context.setDefaultTimeout(12_000);
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.context.on('close', () => {
      this.context = undefined;
      this.page = undefined;
    });
    return this.page;
  }
  async login() {
    const page = await this.open();
    // O JACAD é a entrada confirmada, independentemente de uma URL antiga no .env.
    const login = config.loginUrl.includes('faculdadefocus.jacad.com.br')
      ? assertPortalUrl(config.loginUrl)
      : 'https://faculdadefocus.jacad.com.br/aluno-v2/login';
    await page.goto('https://faculdadefocus.jacad.com.br/aluno-v2', {
      waitUntil: 'domcontentloaded',
    });
    if (/\/login(?:[/?]|$)/.test(page.url())) {
      await page.goto(login, { waitUntil: 'domcontentloaded' });
      if (!config.username || !config.password)
        throw new NeedsAction('Configure USERNAME e PASSWORD no .env ou faça login no navegador.');
      await page
        .getByRole('textbox', { name: 'Informe seu RA ou E-mail ou CPF' })
        .fill(config.username);
      await page.getByRole('textbox', { name: 'Informe a sua senha' }).fill(config.password);
      await page
        .getByRole('button', { name: /Acessar/ })
        .first()
        .click();
      await page
        .waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 })
        .catch(() => {});
    }
    await assertReadable(page);
    if (/\/login(?:[/?]|$)/.test(page.url()))
      throw new NeedsAction('O login não foi concluído. Confira o acesso no navegador.');
    await avaEntry(page)
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
    return page;
  }
  async ava() {
    const page = await this.login();
    const entry = avaEntry(page);
    if (!(await entry.count()))
      throw new NeedsAction('Entrada AVA não encontrada no JACAD. Confira o portal no navegador.');
    const popupPromise = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
    await entry.click({ noWaitAfter: true });
    const popup = await popupPromise;
    const avaPage = popup || page;
    await avaPage.waitForLoadState('domcontentloaded');
    await avaPage.goto(assertPortalUrl(config.courseUrl), { waitUntil: 'domcontentloaded' });
    await assertReadable(avaPage);
    this.page = avaPage;
    return avaPage;
  }
  async close() {
    await this.context?.close();
  }
}
