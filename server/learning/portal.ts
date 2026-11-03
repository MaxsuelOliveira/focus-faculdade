import { discoverPortalCourses } from '../portal/sync.js';
import type { Page } from 'playwright';
import type { Job, Course } from '../../shared/types.js';
import type { Store } from '../db.js';
import { assertPortalUrl, assertReadable, type PortalSession } from '../automation/session.js';
import { LearningStore } from './store.js';
import { consumeExternal } from './external.js';
import { LocalOcr } from './ocr.js';

const avaHost = 'graduacao.faculdadefocus.edu.br';
function readableUrl(input: string) {
  const u = new URL(assertPortalUrl(input));
  if (
    u.hostname !== avaHost ||
    !/^\/(course\/(view|section)|mod\/(page|book|resource|url|folder|lti)\/view)\.php$/.test(
      u.pathname,
    )
  )
    throw new Error('Material fora do escopo de leitura.');
  return u.href;
}
async function links(page: Page) {
  return page
    .locator('#region-main a[href]')
    .evaluateAll((ns) =>
      ns
        .map((n) => ({ title: (n.textContent || '').trim(), url: (n as HTMLAnchorElement).href }))
        .filter((n) => n.title),
    );
}
export async function discoverLearning(store: Store) {
  await discoverPortalCourses(store);
  store.setSetting('learningDiscoveryAt', store.now());
}
export async function consumeLearning(store: Store, session: PortalSession, job: Job) {
  const repo = new LearningStore(store);
  const runId = Number(store.jobPayload(job.id).runId);
  const run = repo.run(runId);
  if (run.status === 'paused' || run.status === 'completed') return;
  const course = store.db.prepare('SELECT * FROM courses WHERE id=?').get(run.course_id) as Course;
  if (!course.url) {
    repo.snapshot(runId);
    repo.status(runId, 'needs_action', 'Adicione materiais locais para esta disciplina.');
    return;
  }
  repo.status(runId, 'running');
  const ocr = new LocalOcr(store.directory);
  try {
    const page = await session.ava();
    const queue = [readableUrl(course.url)];
    const visited = new Set<string>();
    while (queue.length && visited.size < 200) {
      if (repo.run(runId).status === 'paused') return;
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      repo.status(runId, 'running');
      store.updateJob(
        job.id,
        'running',
        `Consultando material ${visited.size} · ${queue.length} na fila`,
      );
      if (new URL(url).pathname === '/mod/resource/view.php') {
        await consumeExternal(
          page,
          repo,
          course.id,
          { url, title: 'Arquivo da disciplina' },
          30,
          ocr,
        );
        continue;
      }
      const popupPromise =
        new URL(url).pathname === '/mod/lti/view.php'
          ? page.waitForEvent('popup', { timeout: 12000 }).catch(() => null)
          : null;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await assertReadable(page);
      if (popupPromise) {
        const popup = await popupPromise;
        if (popup) {
          try {
            await popup.waitForURL((u) => u.hostname === 'scorm.onilearning.com.br', {
              timeout: 20000,
            });
            await popup.waitForLoadState('domcontentloaded');
            await consumeExternal(
              popup,
              repo,
              course.id,
              {
                url: popup.url(),
                title: 'Unidade de videoaulas',
              },
              30,
              ocr,
            );
          } finally {
            await popup.close();
          }
        } else
          repo.source({
            course_id: course.id,
            external_key: `lti:${url}`,
            title: 'Videoaula externa',
            url,
            kind: 'video',
            status: 'pending',
            content: '',
            locator: '',
            reason: 'A ferramenta externa não abriu. Acesso manual necessário.',
          });
        continue;
      }
      const actual = new URL(page.url());
      if (actual.hostname !== avaHost) {
        repo.source({
          course_id: course.id,
          external_key: url,
          title: 'Recurso externo',
          url,
          kind: 'link',
          status: 'pending',
          content: '',
          locator: '',
          reason: 'Recurso externo exige importação autorizada.',
        });
        continue;
      }
      const title = (await page.locator('h1').first().innerText()).trim();
      const content = (await page.locator('#region-main').innerText()).trim();
      const outgoing = await links(page);
      const enrollment = /Opções de inscrição|Você não pode se inscrever/i.test(content);
      const navigationPage =
        content.length < 1200 && outgoing.some((link) => new URL(link.url).hostname !== avaHost);
      const isCourse = actual.pathname.startsWith('/course/');
      if (!isCourse)
        repo.source({
          course_id: course.id,
          external_key: url,
          title,
          url,
          kind:
            actual.pathname === '/mod/url/view.php' || navigationPage || enrollment
              ? 'link'
              : 'text',
          status: content && !enrollment ? 'ready' : 'pending',
          content: enrollment ? '' : content,
          locator: 'Página HTML completa',
          reason: enrollment
            ? 'O portal apresentou opções de inscrição; nenhum material foi declarado consumido.'
            : content
              ? ''
              : 'Página sem texto extraível.',
        });
      const media = await page
        .locator(
          '#region-main iframe[src], #region-main video[src], #region-main video source[src], #region-main a[href*=".pdf"], #region-main object[data], #region-main embed[src]',
        )
        .evaluateAll((ns) =>
          ns.map((n) => ({
            url: n.getAttribute('src') || n.getAttribute('href') || n.getAttribute('data') || '',
            type: n.tagName.toLowerCase(),
          })),
        );
      for (const m of media) {
        const mediaUrl = new URL(m.url, url);
        mediaUrl.hash = '';
        repo.source({
          course_id: course.id,
          external_key: `media:${mediaUrl.href}`,
          title: `${title} · ${/\.pdf(?:$|\?)/i.test(mediaUrl.href) ? 'PDF' : 'Mídia'}`,
          url: mediaUrl.href,
          kind: /\.pdf(?:$|\?)/i.test(mediaUrl.href) ? 'pdf' : 'video',
          status: 'pending',
          content: '',
          locator: '',
          reason: 'Aguardando extração do arquivo ou transcrição com marcações de tempo.',
        });
      }
      for (const link of outgoing) {
        if (
          [
            'scorm.onilearning.com.br',
            'www.scielo.br',
            'bibliogratuita.curatoriaeditora.com.br',
            'guia.faculdadefocus.com.br',
          ].includes(new URL(link.url).hostname)
        ) {
          const external = await page.context().newPage();
          try {
            await consumeExternal(external, repo, course.id, link, 30, ocr);
          } finally {
            await external.close();
          }
          continue;
        }
        try {
          const next = readableUrl(link.url);
          const u = new URL(next);
          if (u.pathname === '/course/view.php' && u.searchParams.get('id') !== course.external_id)
            continue;
          if (u.pathname === '/course/section.php' || u.pathname.startsWith('/mod/'))
            if (!visited.has(next)) queue.push(next);
        } catch {
          if (!/\/mod\/(quiz|assign)\//.test(link.url) && new URL(link.url).hostname !== avaHost)
            repo.source({
              course_id: course.id,
              external_key: link.url,
              title: link.title,
              url: link.url,
              kind: 'link',
              status: 'pending',
              content: '',
              locator: '',
              reason: 'Link externo ainda não consumido.',
            });
        }
      }
    }
    repo.snapshot(runId);
    repo.status(
      runId,
      'needs_action',
      queue.length
        ? 'Limite de descoberta atingido. Confira materiais restantes.'
        : 'Leitura concluída. Confira pendências e gere o caderno com as fontes consumidas.',
    );
  } catch (error) {
    repo.status(
      runId,
      'needs_action',
      'Consumo interrompido. Confira sessão e materiais antes de retomar.',
    );
    throw error;
  } finally {
    await ocr.close();
  }
}
