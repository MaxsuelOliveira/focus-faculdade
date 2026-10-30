import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const env = existsSync('.env') ? parse(readFileSync('.env')) : {};
const secrets = Object.entries(env)
  .filter(([key, value]) => /PASSWORD|USERNAME|API_KEY|SECRET|TOKEN/.test(key) && value.length >= 4)
  .map(([, value]) => value);
const privatePath =
  /(^|\/)(?:data|academic|private|node_modules|output|\.playwright-cli|test-results|playwright-report)\/|(^|\/)\.env(?:\..+)?$|\.(?:sqlite(?:-wal|-shm)?|db|pem|key)$/i;
const patterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{25,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const findings = new Set();
function check(name, bytes) {
  if (name !== '.env.example' && privatePath.test(name)) findings.add(`arquivo privado: ${name}`);
  const text = bytes.toString('utf8');
  if (secrets.some((value) => text.includes(value)))
    findings.add(`valor privado conhecido: ${name}`);
  if (patterns.some((pattern) => pattern.test(text))) findings.add(`padrão de segredo: ${name}`);
}
const files = git('ls-files', '-z').toString().split('\0').filter(Boolean);
for (const file of files) if (existsSync(file)) check(file, readFileSync(file));
const objects = git('rev-list', '--objects', '--all').toString().trim().split('\n').filter(Boolean);
// Batch input avoids printing secret-bearing content or spawning a command per blob.
const raw = execFileSync('git', ['cat-file', '--batch'], {
  input: objects.map((line) => line.split(' ')[0]).join('\n') + '\n',
  maxBuffer: 64 * 1024 * 1024,
});
let offset = 0;
for (const object of objects) {
  const end = raw.indexOf(10, offset);
  const [, type, sizeText] = raw.subarray(offset, end).toString().split(' ');
  const size = Number(sizeText);
  offset = end + 1;
  if (type === 'blob')
    check(object.slice(object.indexOf(' ') + 1), raw.subarray(offset, offset + size));
  offset += size + 1;
}
if (findings.size) {
  console.error([...findings].join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Verificação aprovada: ${files.length} arquivos rastreados e histórico local; nenhum segredo detectado. Valores privados nunca são exibidos.`,
  );
}
