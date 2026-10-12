import fs from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
for (const [name, variable] of [['main.js', 'MAIN_SHA256'], ['manifest.json', 'MANIFEST_SHA256'], ['styles.css', 'STYLES_SHA256']]) {
  const expected = process.env[variable];
  if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw Error(`Missing or invalid ${variable}`);
  const file = new URL(name, root), info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error(`Invalid asset: ${name}`);
  const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) throw Error(`Approved asset mismatch: ${name}`);
  console.log(`${actual}  ${name}`);
}
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
console.log(`Verified ${manifest.version} assets`);
