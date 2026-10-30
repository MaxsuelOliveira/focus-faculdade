import type { Job } from '../../shared/types.js';
import { config } from '../config.js';
import { hash, type Store } from '../db.js';
import {
  collectAttempt,
  fillQuestion,
  openAttempt,
  readCourse,
  readQuestionPage,
  readQuiz,
  attemptPages,
  verifyFilled,
} from './ava.js';
import { assertPortalUrl, assertReadable, NeedsAction, PortalSession } from './session.js';

export class PortalRunner {
  session = new PortalSession();
  constructor(private store: Store) {}
  progress(job: Job, text: string) {
    this.store.updateJob(job.id, 'running', text);
  }
  async execute(job: Job) {
    if (job.kind === 'sync') return this.sync(job);
    if (!job.assessment_id) throw new Error('Avaliação ausente.');
    const a = this.store.assessment(job.assessment_id);
    const page = await this.session.ava();
    await page.goto(assertPortalUrl(a.url), { waitUntil: 'domcontentloaded' });
    const info = await readQuiz(page);
    if (a.attempt_id !== info.attempt_id) {
      this.store.db
        .prepare('UPDATE questions SET approved_hash=NULL WHERE assessment_id=?')
        .run(a.id);
      this.store.db.prepare('DELETE FROM confirmations WHERE assessment_id=?').run(a.id);
    }
    this.store.upsertAssessment({ ...a, ...info });
    if (job.kind === 'inspect') return;
    if (job.kind === 'reconcile') {
      if (info.status === 'submitted') {
        this.store.receipt(
          a.id,
          a.attempt_id || info.attempt_id || 'desconhecida',
          'submitted',
          info.instructions,
        );
        this.store.resolveUncertain(a.id);
      } else if (info.attempt_id) {
        await openAttempt(page, this.store.assessment(a.id));
        this.store.replaceQuestions(a.id, await collectAttempt(page), info.attempt_id);
        this.store.resolveUncertain(a.id);
      } else
        throw new NeedsAction(
          'O portal ainda não permite confirmar o estado da tentativa. Confira manualmente.',
        );
      return;
    }
    if (job.kind === 'start') {
      if (info.attempt_id) throw new NeedsAction('Já existe uma tentativa. Use Extrair questões.');
      if (info.status !== 'available')
        throw new NeedsAction('Esta avaliação não está disponível para iniciar.');
      const authorization = this.store.jobPayload(job.id);
      if (
        Date.parse(authorization.expiresAt) < Date.now() ||
        authorization.rulesFingerprint !==
          hash([info.instructions, info.duration_minutes, info.due_at])
      )
        throw new NeedsAction(
          'As regras mudaram ou a autorização de início expirou. Consulte e confirme novamente.',
        );
      this.progress(job, 'Iniciando a tentativa autorizada; o cronômetro pode começar');
      await page
        .getByRole('button', {
          name: /Tentar responder|Responder.*questionário|Tentativa do questionário|Attempt quiz|Iniciar tentativa/i,
        })
        .first()
        .click();
      const confirmation = page.getByRole('button', { name: /Iniciar tentativa|Start attempt/i });
      if (await confirmation.count()) await confirmation.last().click();
      await page.waitForURL((url) => url.pathname.endsWith('/attempt.php'), { timeout: 15_000 });
      await assertReadable(page);
      const attempt = new URL(page.url()).searchParams.get('attempt');
      if (!attempt) throw new NeedsAction('O portal não retornou o identificador da tentativa.');
      this.store.replaceQuestions(a.id, await collectAttempt(page), attempt);
      this.store.upsertAssessment({ ...this.store.assessment(a.id), status: 'in_progress' });
      return;
    }
    const current = this.store.assessment(a.id);
    await openAttempt(page, current);
    const live = await collectAttempt(page);
    if (job.kind === 'extract') {
      this.store.replaceQuestions(a.id, live, info.attempt_id);
      return;
    }
    this.store.ensureReview(a.id);
    const expected = this.store.questions(a.id);
    const questionIdentity = (q: (typeof live)[number]) =>
      hash([q.external_id, q.type, q.prompt, q.choices, q.images]);
    const changed =
      expected.length !== live.length ||
      live.some(
        (q, index) =>
          q.external_id !== expected[index]?.external_id ||
          questionIdentity(q) !== expected[index]?.fingerprint,
      );
    if (changed) {
      this.store.replaceQuestions(a.id, live, info.attempt_id);
      throw new NeedsAction('As questões mudaram no portal. Revise e aprove novamente.');
    }
    if (job.kind === 'submit') {
      const payload = this.store.jobPayload(job.id);
      if (
        Date.parse(payload.expiresAt) < Date.now() ||
        payload.fingerprint !== this.store.submissionFingerprint(a.id)
      )
        throw new NeedsAction('A autorização expirou ou as respostas mudaram. Confirme novamente.');
    }
    const fingerprint = this.store.submissionFingerprint(a.id);
    const pages = await attemptPages(page);
    for (const url of pages) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await assertReadable(page);
      const visible = await readQuestionPage(page);
      for (const question of visible) {
        const saved = expected.find((q) => q.external_id === question.external_id);
        if (!saved) throw new NeedsAction('Questão inesperada. Extraia novamente.');
        await fillQuestion(page, question, saved.answer);
        if (!(await verifyFilled(page, question, saved.answer)))
          throw new NeedsAction('O preenchimento não corresponde à resposta revisada.');
      }
      if (fingerprint !== this.store.submissionFingerprint(a.id))
        throw new NeedsAction(
          'As respostas foram editadas durante o preenchimento. Revise novamente.',
        );
      // O Moodle persiste a página por seu próprio formulário; sem chamadas internas inventadas.
      const finish = page.locator('input[name=next], button[name=next]').first();
      if (!(await finish.count()))
        throw new NeedsAction('Não foi encontrado o controle de salvamento da página.');
      await finish.click();
      await page.waitForLoadState('domcontentloaded');
    }
    // Conferir respostas já persistidas, reabrindo todas as páginas da tentativa.
    for (const url of pages) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await assertReadable(page);
      for (const q of await readQuestionPage(page)) {
        const saved = expected.find((item) => item.external_id === q.external_id)!;
        if (!(await verifyFilled(page, q, saved.answer)))
          throw new NeedsAction('O portal não confirmou o salvamento de todas as respostas.');
      }
    }
    if (job.kind === 'fill') return;
    this.store.ensureReview(a.id);
    if (fingerprint !== this.store.submissionFingerprint(a.id))
      throw new NeedsAction('As respostas mudaram. Confirme a entrega novamente.');
    if (Date.parse(this.store.jobPayload(job.id).expiresAt) < Date.now())
      throw new NeedsAction(
        'A confirmação expirou durante o preenchimento. Confira e confirme novamente.',
      );
    this.progress(job, 'Enviando a avaliação autorizada e aguardando comprovante');
    await page.goto(
      `https://graduacao.faculdadefocus.edu.br/mod/quiz/summary.php?attempt=${encodeURIComponent(info.attempt_id!)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await assertReadable(page);
    const submit = page.getByRole('button', {
      name: /Enviar tudo e terminar|Submit all and finish/i,
    });
    if ((await submit.count()) !== 1)
      throw new NeedsAction('Controle final de entrega não reconhecido. Confira o navegador.');
    await submit.click();
    const dialog = page.getByRole('dialog');
    if (await dialog.count())
      await dialog
        .getByRole('button', { name: /Enviar tudo e terminar|Submit all and finish/i })
        .click();
    await page.waitForURL((url) => url.pathname.endsWith('/review.php'), {
      timeout: 20_000,
      waitUntil: 'domcontentloaded',
    });
    await assertReadable(page);
    const summary = page.locator('.quizreviewsummary');
    if (!(await summary.count()))
      throw new NeedsAction(
        'Entrega sem comprovante reconhecido. Reconcilie antes de tentar novamente.',
      );
    const evidence = (await summary.innerText()).trim();
    if (!/Finalizada|Finished|Enviad|Submitted/i.test(evidence))
      throw new NeedsAction(
        'Entrega sem comprovante reconhecido. Reconcilie antes de tentar novamente.',
      );
    this.store.receipt(a.id, info.attempt_id!, 'submitted', evidence);
    this.store.upsertAssessment({ ...this.store.assessment(a.id), status: 'submitted' });
  }
  async sync(job: Job) {
    const page = await this.session.ava();
    const target = this.store.jobPayload(job.id).courseExternalId;
    if (target && !/^[1-9]\d{0,9}$/.test(target)) throw new Error('Disciplina inválida.');
    if (target)
      await page.goto(
        assertPortalUrl(`https://graduacao.faculdadefocus.edu.br/course/view.php?id=${target}`),
        { waitUntil: 'domcontentloaded' },
      );
    const first = await readCourse(page);
    const candidates = target
      ? [page.url()]
      : [config.courseUrl, ...first.courses.map((c) => c.url)];
    const urls = candidates.flatMap((input) => {
      try {
        const url = new URL(input);
        const id = url.searchParams.get('id');
        if (url.hostname !== 'graduacao.faculdadefocus.edu.br' || !id || id === '1') return [];
        return [
          `https://graduacao.faculdadefocus.edu.br/course/view.php?id=${encodeURIComponent(id)}`,
        ];
      } catch {
        return [];
      }
    });
    let index = 0;
    let skipped = 0;
    for (const url of [...new Set(urls)].slice(0, 80)) {
      this.progress(job, `Consultando disciplina ${++index}`);
      await page.goto(assertPortalUrl(url), { waitUntil: 'domcontentloaded' });
      await assertReadable(page);
      if (new URL(page.url()).pathname !== '/course/view.php') {
        skipped++;
        continue;
      }
      const course = await readCourse(page);
      const saved = this.store.course(course);
      for (const material of course.materials.slice(0, 100)) {
        await page.goto(assertPortalUrl(material.url), { waitUntil: 'domcontentloaded' });
        await assertReadable(page);
        const region = page.locator('#region-main');
        if (await region.count()) {
          const content = (await region.innerText()).trim().slice(0, 150000);
          if (content) this.store.upsertMaterial(saved.id, material.title, content, material.url);
        }
      }
      for (const quiz of course.quizzes) {
        await page.goto(assertPortalUrl(quiz.url), { waitUntil: 'domcontentloaded' });
        const info = await readQuiz(page);
        const external_id = new URL(quiz.url).searchParams.get('id');
        if (!external_id) continue;
        this.store.upsertAssessment({ ...info, external_id, course_id: saved.id, url: quiz.url });
      }
    }
    this.store.setSetting('lastSync', this.store.now());
    this.store.updateReminders();
    this.store.updateJob(
      job.id,
      'completed',
      `Consulta concluída: ${index - skipped} disciplinas; ${skipped} links indisponíveis ignorados.`,
    );
  }
}
