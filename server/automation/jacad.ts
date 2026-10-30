import type { Page } from 'playwright';
// O texto do menu contém espaços/quebras de linha do template JACAD.
export const avaEntry = (page: Page) =>
  page
    .locator('a')
    .filter({ hasText: /^\s*AVA\s*$/i })
    .first();
