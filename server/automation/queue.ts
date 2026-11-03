import type { Job } from '../../shared/types.js';
import type { Store } from '../db.js';
import { NeedsAction } from './session.js';
export class JobQueue {
  busy = false;
  stopped = false;
  constructor(
    private store: Store,
    private execute: (job: Job) => Promise<void>,
  ) {
    store.recover();
  }
  async tick() {
    if (this.busy || this.stopped) return;
    const job = this.store.nextJob();
    if (!job) return;
    this.busy = true;
    this.store.updateJob(
      job.id,
      'running',
      ['sync', 'learn_discover'].includes(job.kind)
        ? 'Autenticando por HTTP e consultando API estruturada'
        : job.kind === 'learn_generate'
          ? 'Preparando fontes e modelo local'
          : job.kind === 'learn_transcribe'
            ? 'Preparando legendas e transcrição local'
            : 'Abrindo navegador e verificando sessão',
    );
    try {
      await this.execute(job);
      if (this.store.job(job.id).status === 'running') {
        const runId = this.store.jobPayload(job.id).runId;
        const paused =
          job.kind.startsWith('learn_') &&
          runId &&
          (
            this.store.db
              .prepare('SELECT status FROM learning_runs WHERE id=?')
              .get(Number(runId)) as { status: string } | undefined
          )?.status === 'paused';
        this.store.updateJob(
          job.id,
          paused ? 'needs_action' : 'completed',
          paused ? 'Consumo pausado. Retome no painel.' : 'Concluído',
        );
      }
    } catch (error) {
      // Erros de Playwright podem incluir valores de campos; nunca persistir mensagens brutas.
      const uncertain = ['submit', 'fill', 'start'].includes(job.kind);
      this.store.updateJob(
        job.id,
        uncertain ? 'uncertain' : error instanceof NeedsAction ? 'needs_action' : 'failed',
        error instanceof NeedsAction
          ? error.message
          : 'Operação não concluída. Confira o navegador e reconcilie antes de repetir ações.',
      );
    } finally {
      this.busy = false;
    }
  }
}
