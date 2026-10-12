const path = require('node:path');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath,
  ['node_modules/eslint/bin/eslint.js', 'src', 'manifest.json', '--max-warnings', '0'],
  { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', timeout: 60000 });
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
