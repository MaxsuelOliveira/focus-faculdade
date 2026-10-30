import { readdir, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './db.js';
export async function backup(store: Store, force = false) {
  const day = new Date().toISOString().slice(0, 10);
  if (!force && store.setting('lastBackup') === day) return;
  const directory = path.join(store.directory, 'backups');
  await mkdir(directory, { recursive: true });
  const filename = `focus-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  await store.db.backup(path.join(directory, filename));
  store.setSetting('lastBackup', day);
  const files = (await readdir(directory))
    .filter((f) => /^focus-.*\.sqlite$/.test(f))
    .sort()
    .reverse();
  await Promise.all(files.slice(14).map((f) => unlink(path.join(directory, f))));
  return filename;
}
