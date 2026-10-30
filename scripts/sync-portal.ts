import { Store } from '../server/db.js';
import { config } from '../server/config.js';
import { PortalRunner } from '../server/automation/runner.js';
import { JobQueue } from '../server/automation/queue.js';
const store = new Store(config.dataDir);
const runner = new PortalRunner(store);
const queue = new JobQueue(store, (job) => runner.execute(job));
try {
  const id = store.enqueue('sync', null);
  await queue.tick();
  const data = store.dashboard();
  console.log(
    JSON.stringify(
      {
        job: store.job(id),
        courses: data.courses.length,
        assessments: data.assessments.length,
        materials: store.db.prepare('SELECT count(*) total FROM materials').get(),
      },
      null,
      2,
    ),
  );
  if (store.job(id).status !== 'completed') process.exitCode = 1;
} finally {
  await runner.session.close();
  store.close();
}
