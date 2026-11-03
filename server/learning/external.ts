import type { Page, Request, Response } from 'playwright';
import type { LearningStore } from './store.js';
import { pdfText } from './pdf.js';
import { canonicalSourceKey } from './identity.js';
import { mediaIdentity } from './media.js';
import type { LocalOcr } from './ocr.js';

const allowed = new Set([
  'graduacao.faculdadefocus.edu.br',
  'scorm.onilearning.com.br',
  'www.scielo.br',
  'bibliogratuita.curatoriaeditora.com.br',
  'guia.faculdadefocus.com.br',
]);
export function allowedMaterialUrl(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== 'https:' ||
    !allowed.has(u.hostname) ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443')
  )
    throw new Error('Fonte fora do escopo autorizado.');
  return u.href;
}
export async function consumeExternal(
  page: Page,
  repo: LearningStore,
  courseId: number,
  input: { url: string; title: string },
  limit = 30,
  ocr?: LocalOcr,
) {
  const queue = [input];
  const seen = new Set<string>();
  while (queue.length && seen.size < limit) {
    const item = queue.shift()!;
    if (
      repo
        .sources(courseId)
        .some((s) => s.external_key === canonicalSourceKey(item.url) && s.status === 'excluded')
    )
      continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const base = {
      course_id: courseId,
      external_key: item.url,
      title: item.title,
      url: item.url,
      content: '',
      locator: '',
      reason: '',
      kind: 'link' as const,
      status: 'pending' as const,
    };
    try {
      let url = allowedMaterialUrl(item.url);
      let response;
      for (let hop = 0; hop < 8; hop++) {
        response = await page.context().request.get(url, { maxRedirects: 0, timeout: 30000 });
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location) {
          url = allowedMaterialUrl(new URL(location, url).href);
          await response.dispose();
          continue;
        }
        break;
      }
      if (!response) throw new Error('Resposta indisponível.');
      if (!response.ok()) {
        repo.source({
          ...base,
          reason: `O link do material retornou HTTP ${response.status()}. Nenhum conteúdo foi declarado consumido.`,
        });
        await response.dispose();
        continue;
      }
      const contentType = response.headers()['content-type'] || '';
      if (contentType.startsWith('image/')) {
        if (!ocr) {
          repo.source({
            ...base,
            kind: 'image',
            reason: 'OCR local não disponível para esta imagem.',
          });
          await response.dispose();
          continue;
        }
        const recognized = await ocr.read(await response.body());
        repo.source({
          ...base,
          kind: 'image',
          status: 'ready',
          content: recognized.text,
          locator: `OCR local da imagem completa; confiança ${recognized.confidence.toFixed(0)}%. Relações visuais requerem revisão.`,
          reason: '',
        });
        await response.dispose();
        continue;
      }
      if (contentType.includes('application/pdf')) {
        const pages = await pdfText(await response.body());
        const content = pages.map((p) => `[Página ${p.page}]\n${p.text}`).join('\n\n');
        const empty = pages.filter((p) => !p.text).length;
        const previous = repo
          .sources(courseId)
          .find((s) => s.external_key === canonicalSourceKey(item.url));
        const extracted = repo.source({
          ...base,
          kind: 'pdf',
          status: pages.some((p) => p.text) ? 'ready' : 'pending',
          content,
          locator: `Texto extraído das páginas ${pages
            .filter((p) => p.text)
            .map((p) => p.page)
            .join(', ')}`,
          reason: empty ? `${empty} página(s) sem texto têm pendência separada.` : '',
        });
        const reviewed = repo
          .sources(courseId)
          .find((s) => s.external_key === canonicalSourceKey(`unread-pages:${item.url}`));
        if (
          empty &&
          !(reviewed?.status === 'ready' && previous?.content_hash === extracted.content_hash)
        )
          repo.source({
            ...base,
            external_key: `unread-pages:${item.url}`,
            title: `${item.title} · páginas sem texto`,
            kind: 'pdf',
            status: 'pending',
            content: '',
            locator: `Páginas ${pages
              .filter((p) => !p.text)
              .map((p) => p.page)
              .join(', ')}`,
            reason: 'OCR ou revisão visual necessária; páginas não declaradas consumidas.',
          });
        await response.dispose();
        continue;
      }
      await response.dispose();
      if (!contentType.includes('text/html')) {
        repo.source({ ...base, reason: 'Formato ainda não suportado.' });
        continue;
      }
      const mediaUrls = new Set<string>();
      const pdfUrls = new Set<string>();
      const capture = (request: Request) => {
        if (/\.(?:m3u8|mp4|webm|mp3)(?:[?&#]|$)/i.test(request.url())) mediaUrls.add(request.url());
      };
      page.on('request', capture);
      const captureResponse = (response: Response) => {
        if ((response.headers()['content-type'] || '').includes('application/pdf'))
          pdfUrls.add(response.url());
        if (
          /mpegurl|video\/(?:mp4|webm)|audio\/(?:mpeg|mp4)/i.test(
            response.headers()['content-type'] || '',
          )
        )
          mediaUrls.add(response.url());
      };
      page.on('response', captureResponse);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (new URL(url).hostname === 'scorm.onilearning.com.br')
          await page
            .waitForFunction(
              () => document.title && document.title.toLowerCase() !== 'menu',
              null,
              { timeout: 10000 },
            )
            .catch(() => null);
        if (new URL(url).searchParams.get('componente') === 'mpc')
          await page
            .locator('img[src*="imagem.php"]')
            .first()
            .waitFor({ state: 'visible', timeout: 10000 })
            .catch(() => null);
        if (new URL(url).searchParams.get('componente') === 'videos')
          await page
            .waitForEvent('request', {
              predicate: (r) => /\.m3u8(?:[?#]|$)/i.test(r.url()),
              timeout: 6000,
            })
            .catch(() => null);
        if (
          ['slides', 'ebook'].includes(new URL(url).searchParams.get('componente') || '') &&
          !pdfUrls.size
        )
          await page
            .waitForEvent('response', {
              predicate: (r) => (r.headers()['content-type'] || '').includes('application/pdf'),
              timeout: 20000,
            })
            .catch(() => null);
      } finally {
        page.off('request', capture);
        page.off('response', captureResponse);
      }
      allowedMaterialUrl(page.url());
      if (
        new URL(page.url()).hostname === 'bibliogratuita.curatoriaeditora.com.br' &&
        (await page.locator('input[type=password]:visible').count())
      ) {
        const portal = await page.context().newPage();
        try {
          const course = repo.store.db
            .prepare('SELECT url FROM courses WHERE id=?')
            .get(courseId) as { url: string };
          await portal.goto(allowedMaterialUrl(course.url), { waitUntil: 'domcontentloaded' });
          const entry = await portal
            .getByRole('link', { name: 'Biblioteca Virtual', exact: true })
            .getAttribute('href');
          if (entry && new URL(entry).hostname === 'bibliogratuita.curatoriaeditora.com.br') {
            await page.goto(allowedMaterialUrl(entry), { waitUntil: 'domcontentloaded' });
            await page
              .waitForURL((u) => !u.pathname.includes('biblioIntegracao'), { timeout: 8000 })
              .catch(() => {});
            await page.goto(url, { waitUntil: 'domcontentloaded' });
          }
        } finally {
          await portal.close();
        }
      }
      if (await page.locator('input[type=password]:visible').count()) {
        repo.source({ ...base, reason: 'Autenticação adicional necessária.' });
        continue;
      }
      const text = (await page.locator('body').innerText()).trim();
      let imageCount = 0;
      for (const pdfUrl of pdfUrls)
        queue.push({ url: pdfUrl, title: `${await page.title()} · ${item.title}` });
      if (new URL(url).searchParams.get('componente') === 'mpc') {
        const images = await page
          .locator('img[src*="imagem.php"]')
          .evaluateAll((ns) =>
            ns
              .filter(
                (n) =>
                  (n as HTMLImageElement).naturalWidth > 500 || (n as HTMLImageElement).width > 500,
              )
              .map((n) => (n as HTMLImageElement).src),
          );
        for (const image of images)
          queue.push({
            url: allowedMaterialUrl(image),
            title: `${await page.title()} · mapa conceitual`,
          });
        imageCount = images.length;
      }
      if (
        /checking your browser|just a moment|verifying.{0,20}browser|access denied|captcha/i.test(
          text,
        )
      ) {
        repo.source({
          ...base,
          reason:
            'O site exige verificação de acesso no navegador. Nenhum bloqueio foi contornado.',
        });
        continue;
      }
      const videos = await page.locator('video').count();
      for (const [index, mediaUrl] of [...mediaUrls].entries()) {
        const media = new URL(mediaUrl);
        if (media.protocol !== 'https:') continue;
        const key = mediaIdentity(mediaUrl);
        repo.store.db
          .prepare(
            `INSERT INTO learning_media(course_id,parent_key,media_key,title,page_url,media_url,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(course_id,media_key) DO UPDATE SET media_url=CASE WHEN excluded.media_url LIKE '%LEGENDA.m3u8%' THEN excluded.media_url WHEN learning_media.media_url LIKE '%LEGENDA.m3u8%' THEN learning_media.media_url ELSE excluded.media_url END,updated_at=excluded.updated_at`,
          )
          .run(
            courseId,
            canonicalSourceKey(`video-page:${item.url}`),
            key,
            `${await page.title()} · vídeo ${index + 1}`,
            item.url,
            mediaUrl,
            repo.store.now(),
          );
      }
      const existingVideo = repo
        .sources(courseId)
        .find((s) => s.external_key === canonicalSourceKey(`video-page:${item.url}`));
      const remainingMedia = repo.store.db
        .prepare(
          "SELECT count(*) n FROM learning_media WHERE course_id=? AND parent_key=? AND status!='ready'",
        )
        .get(courseId, canonicalSourceKey(`video-page:${item.url}`)) as { n: number };
      if (videos && !(existingVideo?.status === 'ready' && remainingMedia.n === 0))
        repo.source({
          ...base,
          external_key: `video-page:${item.url}`,
          kind: 'video',
          content: '',
          reason: `${videos} vídeo(s) sem transcrição extraída.`,
          locator: 'Página de videoaulas',
        });
      else if (!videos && !pdfUrls.size && text.length > 200)
        repo.source({
          ...base,
          kind: new URL(url).searchParams.get('componente') === 'trilha' ? 'link' : 'text',
          status: 'ready',
          content: text,
          locator: 'Página HTML do material',
        });
      const links = await page
        .locator('a[href],object[data],embed[src],iframe[src]')
        .evaluateAll((ns) =>
          ns.map((n) => ({
            url: n.getAttribute('href') || n.getAttribute('data') || n.getAttribute('src') || '',
            title: (n.textContent || n.getAttribute('title') || 'Material incorporado').trim(),
            embedded: n.tagName.toLowerCase() !== 'a',
          })),
        );
      for (const link of links) {
        try {
          const frameUrl = new URL(link.url, page.url());
          const embeddedFile =
            frameUrl.searchParams.get('file') || frameUrl.searchParams.get('url');
          if (link.embedded && embeddedFile) {
            try {
              queue.push({
                url: allowedMaterialUrl(new URL(embeddedFile, frameUrl).href),
                title: link.title || item.title,
              });
              continue;
            } catch {
              /* Keep the actual embedded destination below when it is supported. */
            }
          }
          const next = allowedMaterialUrl(new URL(link.url, page.url()).href);
          const u = new URL(next);
          if (
            (link.embedded && u.hostname === new URL(url).hostname) ||
            (u.hostname === 'scorm.onilearning.com.br' &&
              (/(?:ebook|slides|videos|trilha|mpc)/.test(u.searchParams.get('componente') || '') ||
                /arquivo|\.pdf|item-trilha/.test(u.pathname))) ||
            (u.hostname === new URL(url).hostname &&
              (/\.pdf$/i.test(u.pathname) ||
                /\/mod\/(?:resource|page|book)\/view\.php$/.test(u.pathname)))
          )
            queue.push({ url: next, title: link.title || item.title });
        } catch {
          if (link.embedded)
            repo.source({
              ...base,
              external_key: `embedded:${new URL(link.url, page.url()).href}`,
              title: `${item.title} · recurso incorporado`,
              url: new URL(link.url, page.url()).href,
              content: '',
              reason: 'Recurso incorporado ainda não extraído; confira a fonte original.',
            });
        }
      }
      if (pdfUrls.size || imageCount)
        repo.source({
          ...base,
          status: 'ready',
          locator: 'Página de navegação; conteúdo nos arquivos vinculados.',
          reason: '',
        });
      else if (!text.length && !videos)
        repo.source({ ...base, reason: 'Nenhum conteúdo textual acessível.' });
    } catch {
      repo.source({
        ...base,
        reason:
          'Material não extraído. Confira acesso, formato ou necessidade de importação manual.',
      });
    }
  }
  if (queue.length)
    repo.source({
      course_id: courseId,
      external_key: `limit:${input.url}`,
      title: 'Materiais externos restantes',
      url: input.url,
      kind: 'link',
      status: 'pending',
      content: '',
      locator: '',
      reason: 'Limite de descoberta atingido; revisão necessária.',
    });
}
