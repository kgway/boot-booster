const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '.test-build');
if (path.relative(root, output) !== '.test-build') throw Error('Invalid test output path');
fs.rmSync(output, { recursive: true, force: true });
let result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
  '--noEmit', 'false', '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', output],
  { cwd: root, stdio: 'inherit', timeout: 60000 });
if (result.status !== 0) process.exit(result.status ?? 1);
// The bundle smoke test must use this source, including on a fresh checkout.
result = spawnSync(process.execPath, ['esbuild.config.mjs'],
  { cwd: root, stdio: 'inherit', timeout: 60000 });
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
const tests = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.ts')).sort()
  .map(file => path.join(output, 'tests', file.replace(/\.ts$/, '.js')));
result = spawnSync(process.execPath, ['--test', '--test-timeout=15000',
  ...(process.argv.includes('--tap') ? ['--test-reporter=tap'] : []), ...tests],
  { cwd: root, stdio: 'inherit', timeout: 60000 });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
