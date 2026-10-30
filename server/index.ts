import { config } from './config.js';
import { Store } from './db.js';
import { createApp } from './app.js';
import { backup } from './backup.js';
import { PortalRunner } from './automation/runner.js';
import { JobQueue } from './automation/queue.js';
import { OllamaRuntime } from './ollama-runtime.js';
const ollama = new OllamaRuntime();
await ollama.start();
const store = new Store(config.dataDir);
const runner = new PortalRunner(store);
const queue = new JobQueue(store, (job) => runner.execute(job));
const app = await createApp(store, queue);
let maintenanceBusy = false;
async function maintenance() {
  if (maintenanceBusy) return;
  maintenanceBusy = true;
  try {
    store.updateReminders();
    await backup(store);
    const last = store.setting('lastAutoSync') || store.setting('lastSync');
    if (!last || Date.now() - Date.parse(last) >= 30 * 60_000) {
      store.enqueue('sync', null);
      store.setSetting('lastAutoSync', store.now());
    }
  } catch {
    console.error('Manutenção local pendente. Confira espaço em disco e permissões.');
  } finally {
    maintenanceBusy = false;
  }
}
const worker = setInterval(() => {
  void queue.tick();
}, 1500);
const timer = setInterval(() => {
  void maintenance();
}, 60_000);
const close = async () => {
  queue.stopped = true;
  clearInterval(worker);
  clearInterval(timer);
  await runner.session.close();
  // A fila registra interrupções antes de fechar o banco.
  while (queue.busy || maintenanceBusy) await new Promise((resolve) => setTimeout(resolve, 100));
  await app.close();
  ollama.stop();
  store.close();
  process.exit(0);
};
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`Focus Faculdade: http://127.0.0.1:${config.port}`);
void maintenance();
