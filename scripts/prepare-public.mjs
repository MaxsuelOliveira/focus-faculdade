import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

// Export only committed source into a fresh directory; never copy .git or local data.
const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const target = path.resolve('output', 'public-release', `focus-faculdade-${Date.now()}`);
const files = git('ls-tree', '-r', '--name-only', 'HEAD').toString().trim().split('\n');
const excluded = new Set(['documents/PI-III-CHECKLIST.md', 'documents/VALIDATION.md']);
const forbidden =
  /(^|\/)(?:data|academic|private|output|node_modules|\.git)\/|(^|\/)\.env(?:\..*)?$|\.(?:sqlite|db|pem|key)$/i;
const env = existsSync('.env') ? parse(readFileSync('.env')) : {};
const secrets = Object.entries(env)
  .filter(([key, value]) => /PASSWORD|USERNAME|API_KEY|SECRET|TOKEN/.test(key) && value.length >= 4)
  .map(([, value]) => value);
const prepared = [];
for (const name of files) {
  if (excluded.has(name)) continue;
  if (name !== '.env.example' && forbidden.test(name))
    throw new Error(`Arquivo privado no commit: ${name}`);
  const bytes = git('show', `HEAD:${name}`);
  if (secrets.some((value) => bytes.toString('utf8').includes(value)))
    throw new Error(`Valor privado em ${name}; exportação interrompida.`);
  prepared.push({ name, bytes });
}
for (const { name, bytes } of prepared) {
  const destination = path.resolve(target, name);
  if (!destination.startsWith(target + path.sep)) throw new Error('Caminho fora da exportação.');
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}
console.log(
  JSON.stringify({
    directory: target,
    files: prepared.length,
    sourceCommit: git('rev-parse', 'HEAD').toString().trim(),
    historyCopied: false,
  }),
);
