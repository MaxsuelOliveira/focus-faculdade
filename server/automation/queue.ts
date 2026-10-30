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
    this.store.updateJob(job.id, 'running', 'Abrindo navegador e verificando sessão');
    try {
      await this.execute(job);
      if (this.store.job(job.id).status === 'running')
        this.store.updateJob(job.id, 'completed', 'Concluído');
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
