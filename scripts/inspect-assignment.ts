import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PortalSession, assertReadable, assertPortalUrl } from '../server/automation/session.js';
import { config } from '../server/config.js';
const directory = path.join(config.dataDir, 'assignments', '104945');
const session = new PortalSession();
try {
  const page = await session.ava();
  await page.goto(
    'https://graduacao.faculdadefocus.edu.br/mod/assign/view.php?id=104945&forceview=1',
    { waitUntil: 'domcontentloaded' },
  );
  await assertReadable(page);
  const region = page.locator('#region-main');
  const title = await page.locator('h1').first().innerText();
  const text = await region.innerText();
  const links = await region.locator('a').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.trim(),
      url: (node as HTMLAnchorElement).href,
    })),
  );
  const navigation = await page
    .locator('select option')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({ text: node.textContent?.trim(), url: (node as HTMLOptionElement).value }))
        .filter((item) => item.url),
    );
  const courses = await page.locator('a[href*="/course/view.php"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.trim(),
      url: (node as HTMLAnchorElement).href,
    })),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'assignment.json'),
    JSON.stringify(
      {
        title,
        url: page.url(),
        text,
        links,
        navigation,
        courses,
        inspectedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ title, text, links, navigation, courses }, null, 2));
  for (const [index, link] of links.entries()) {
    if (!/pluginfile\.php|\.pdf(?:\?|$)|\.docx?(?:\?|$)|\.xlsx?(?:\?|$)/i.test(link.url)) continue;
    const response = await page.context().request.get(assertPortalUrl(link.url));
    if (!response.ok()) {
      console.log('Documento indisponível:', link.text, response.status());
      continue;
    }
    const type = response.headers()['content-type'] || '';
    if (type.includes('text/html')) {
      console.log('Documento retornou HTML:', link.text);
      continue;
    }
    const name = decodeURIComponent(
      new URL(link.url).pathname.split('/').pop() || `documento-${index}`,
    ).replace(/[<>:"/\\|?*]/g, '-');
    const file = path.join(directory, `${index}-${name}`);
    await writeFile(file, await response.body());
    console.log('Documento salvo:', file, type);
  }
  const documents: object[] = [];
  for (const item of navigation.filter((item) =>
    /Metodologia|Manual|Modelo|Plantão/i.test(item.text || ''),
  )) {
    const url = new URL(item.url, 'https://graduacao.faculdadefocus.edu.br').href;
    const response = await page.context().request.get(assertPortalUrl(url));
    const type = response.headers()['content-type'] || '';
    console.log('Material:', item.text, 'URL:', response.url(), 'tipo:', type);
    if (type.includes('pdf') || type.includes('officedocument') || type.includes('msword')) {
      const filename = `${new URL(url).searchParams.get('id')}.${type.includes('pdf') ? 'pdf' : 'docx'}`;
      await writeFile(path.join(directory, filename), await response.body());
      documents.push({ title: item.text, portalUrl: url, url: response.url(), file: filename });
      continue;
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const body = page.locator('#region-main');
    const content = (await body.count())
      ? await body.innerText()
      : (await page.locator('body').innerText()).slice(0, 8000);
    const resources = await page
      .locator('.urlworkaround a, #region-main a, iframe')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => ({
            text: node.textContent?.trim(),
            url: (node as HTMLAnchorElement).href || (node as HTMLIFrameElement).src,
          }))
          .filter((item) => item.url),
      );
    console.log(JSON.stringify({ title: item.text, content, resources }, null, 2));
    documents.push({ title: item.text, portalUrl: url, url: page.url(), content, resources });
    for (const [index, resource] of resources.entries()) {
      if (!/\.pdf(?:[?#]|$)|\.docx?(?:[?#]|$)|pluginfile.php/i.test(resource.url)) continue;
      const downloaded = await page.context().request.get(resource.url);
      if (!downloaded.ok()) continue;
      const filename = `${new URL(url).searchParams.get('id')}-${index}.${/\.docx/i.test(resource.url) ? 'docx' : 'pdf'}`;
      await writeFile(path.join(directory, filename), await downloaded.body());
      documents.push({
        title: resource.text || item.text,
        portalUrl: url,
        url: resource.url,
        file: filename,
      });
      console.log('Documento salvo:', filename);
    }
  }
  await writeFile(path.join(directory, 'documents.json'), JSON.stringify(documents, null, 2));
} finally {
  await session.close();
}
