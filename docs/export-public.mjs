import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const allow = JSON.parse(fs.readFileSync(path.join(root, 'docs/public-files.json'), 'utf8'));
const files = [...allow.files];
function walk(relative) {
  const full = path.join(root, relative), info = fs.lstatSync(full);
  if (info.isSymbolicLink()) throw Error(`Symlink rejected: ${relative}`);
  if (info.isDirectory()) {
    for (const name of fs.readdirSync(full).sort()) walk(`${relative}/${name}`);
  } else {
    if (!info.isFile() || !/\.(ts|json)$/.test(relative)) throw Error(`Unexpected source file: ${relative}`);
    files.push(relative);
  }
}
for (const dir of allow.directories) walk(dir);
if (new Set(files).size !== files.length) throw Error('Duplicate export entry');
const digest = {};
for (const name of files.sort()) {
  if (name.includes('..') || path.isAbsolute(name)) throw Error('Unsafe export path');
  const full = path.join(root, name), info = fs.lstatSync(full);
  if (!info.isFile() || info.isSymbolicLink()) throw Error(`Invalid export file: ${name}`);
  const bytes = fs.readFileSync(full), text = bytes.toString('utf8');
  const findings = [
    ['personal-path', /(?:[a-z]:[\\/]Users[\\/](?!example[\\/])|\/Users\/(?!example\/)|\/home\/(?!example\/))/i],
    ['credential', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/],
    ['private-email', /\b[A-Z0-9._%+-]+@(?!users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  if (findings.length) throw Error(`Export scan failed: ${name}: ${findings.join(', ')}`);
  digest[name] = createHash('sha256').update(bytes).digest('hex');
}
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ files: files.length, scan: 'passed' }));
} else {
  const argument = process.argv[2];
  if (!argument || argument.startsWith('--')) throw Error('Usage: node docs/export-public.mjs <new-directory> | --check');
  const destination = path.resolve(root, argument), relative = path.relative(root, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.existsSync(destination)) throw Error('Use a new directory inside this workspace');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of files) {
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, name), target);
  }
  // Keep this manifest beside the export, not inside public source.
  fs.writeFileSync(destination + '.sha256.json', JSON.stringify(digest, null, 2) + '\n');
  console.log(JSON.stringify({ files: files.length, destination: relative, historyCopied: false }));
}
