import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('publicação rejeita segredos atuais e históricos sem mostrar os valores', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-privacy-'));
  const script = path.resolve('scripts/check-public.mjs');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  const scan = () => spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
  try {
    git('init');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(path.join(directory, '.env'), 'PASSWORD=PRIVATE_TEST_VALUE_12345\n');
    writeFileSync(path.join(directory, '.gitignore'), '.env\n');
    writeFileSync(path.join(directory, 'code.txt'), 'Conteúdo público');
    git('add', '.gitignore', 'code.txt');
    git('commit', '-m', 'clean');
    assert.equal(scan().status, 0);
    writeFileSync(path.join(directory, 'code.txt'), 'PRIVATE_TEST_VALUE_12345');
    const leak = scan();
    assert.equal(leak.status, 1);
    assert.ok(!leak.stderr.includes('PRIVATE_TEST_VALUE_12345'));
    git('add', 'code.txt');
    git('commit', '-m', 'synthetic leak');
    writeFileSync(path.join(directory, 'code.txt'), 'Conteúdo público novamente');
    git('add', 'code.txt');
    git('commit', '-m', 'remove synthetic leak');
    assert.equal(scan().status, 1, 'remover da versão atual não limpa o histórico');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
