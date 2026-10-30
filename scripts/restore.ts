import { copyFile, access, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';
const source = process.argv[2];
if (!source || process.argv[3] !== '--app-stopped')
  throw new Error(
    'Feche o aplicativo e execute: npm run restore -- caminho-do-backup --app-stopped',
  );
const resolved = path.resolve(source);
const target = path.join(config.dataDir, 'focus.sqlite');
if (resolved === target) throw new Error('Escolha um arquivo de backup diferente do banco atual.');
const probe = new Database(resolved, { readonly: true, fileMustExist: true });
try {
  if (
    probe.pragma('integrity_check', { simple: true }) !== 'ok' ||
    !probe.prepare("SELECT 1 FROM sqlite_master WHERE name='migrations'").get()
  )
    throw new Error('Backup inválido.');
} finally {
  probe.close();
}
for (const suffix of ['-wal', '-shm']) {
  const exists = await access(target + suffix, constants.F_OK)
    .then(() => true)
    .catch(() => false);
  if (exists)
    throw new Error(
      'Arquivos WAL/SHM presentes. Feche o aplicativo corretamente antes da restauração.',
    );
}
const temporary = target + '.restore';
await copyFile(resolved, temporary);
if (
  await access(target)
    .then(() => true)
    .catch(() => false)
)
  await rename(target, target + `.before-restore-${Date.now()}`);
await rename(temporary, target);
console.log('Banco restaurado. O banco anterior foi preservado, se existia.');
