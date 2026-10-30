import { Store } from '../server/db.js';
import { config } from '../server/config.js';
import { backup } from '../server/backup.js';
const store = new Store(config.dataDir);
try {
  console.log('Backup criado:', await backup(store, true));
} finally {
  store.close();
}
