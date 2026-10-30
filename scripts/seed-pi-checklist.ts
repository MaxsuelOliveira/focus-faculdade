import { Store } from '../server/db.js';
import { config } from '../server/config.js';
import { ChecklistStore } from '../server/checklist-store.js';
import { piIiiAdsPlan } from '../server/plans/pi-iii-ads.js';
import { backup } from '../server/backup.js';
const store = new Store(config.dataDir);
try {
  await backup(store, true);
  const plan = new ChecklistStore(store.db).seed(piIiiAdsPlan);
  console.log(
    JSON.stringify(
      {
        id: plan.id,
        title: plan.title,
        items: plan.items.length,
        required: plan.items.filter((item) => item.required).length,
        completed: plan.items.filter((item) => item.done).length,
        personalDue: plan.personal_due_at,
        officialDue: plan.official_due_at,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
