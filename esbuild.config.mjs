import { build } from 'esbuild';
import { mkdir, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import textCheck from './docs/check-text.cjs';
const root = fileURLToPath(new URL('.', import.meta.url));
textCheck.checkFiles(root);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const license = pkg.license ? (await readFile(resolve(root, 'LICENSE'), 'utf8')).trim() : '';
const result = await build({ absWorkingDir: root, entryPoints: ['./src/main.ts'], tsconfig: resolve(root, 'tsconfig.json'), bundle: true, external: ['obsidian'],
  platform: 'browser', format: 'cjs', target: 'es2020', outfile: 'main.js', metafile: true,
  banner: { js: '/* Boot Booster — generated from src/. */' + (license ? '\n/*!\n' + license + '\n*/' : '') } });
for (const name of Object.keys(result.metafile.inputs)) {
  if (!(name.startsWith('src/') && name.endsWith('.ts')) && !/^src\/locales\/(ja|en)\.json$/.test(name)) throw Error(`Unexpected bundle input: ${name}`);
}
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(item => !item.external || item.path !== 'obsidian')) throw Error('Unexpected runtime import');
}
const stage = resolve(root, 'dist/boot-booster');
if (relative(root, stage).replaceAll('\\', '/') !== 'dist/boot-booster') throw Error('Invalid staging path');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(resolve(root, file), resolve(stage, file));
await writeFile(resolve(root, 'dist/build-meta.json'), JSON.stringify(result.metafile, null, 2) + '\n');
