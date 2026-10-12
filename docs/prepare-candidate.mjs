import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import core from './candidate-core.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    throw Error(result.error?.message ?? `Check failed: ${args[0]}`);
  }
  return result.stdout;
}
function runtime() { return Object.fromEntries(core.runtimeFiles.map(name => [name, fs.readFileSync(path.join(root, name))])); }

const inputs = core.readInputs(root), inputHashes = core.hashes(inputs);
const manifest = JSON.parse(inputs['manifest.json']), pkg = JSON.parse(inputs['package.json']);
run(['node_modules/typescript/bin/tsc', '--noEmit']);
run(['docs/lint.cjs']);
run(['esbuild.config.mjs']);
const first = core.hashes(runtime());
const tap = run(['docs/test.cjs', '--tap']);
const count = name => Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
const tests = { command: 'node docs/test.cjs --tap', typecheck: true, lint: true, total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled') };
if (!(tests.total > 0) || tests.passed !== tests.total || tests.failed !== 0 || tests.skipped !== 0 || tests.cancelled !== 0) throw Error('Incomplete test report');
run(['esbuild.config.mjs']);
const files = runtime(), runtimeHashes = core.hashes(files);
if (JSON.stringify(first) !== JSON.stringify(runtimeHashes)) throw Error('Rebuild does not match the tested candidate');
if (JSON.stringify(inputHashes) !== JSON.stringify(core.hashes(core.readInputs(root)))) throw Error('Inputs changed while checks were running');
const meta = JSON.parse(fs.readFileSync(path.join(root, 'dist/build-meta.json')));
core.checkRuntime(files, manifest, pkg, meta);
const install = inputs['docs/candidate-install.md'];
if (/(?:[a-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)/i.test(install.toString('utf8'))) throw Error('Personal path in install guide');
const zipped = core.createZip(Object.fromEntries([...Object.entries(files), ['INSTALL.md', install]].map(([name, bytes]) => ['boot-booster/' + name, bytes])));
const archiveHash = core.sha256(zipped), sourceDigest = core.sha256(JSON.stringify(inputHashes));
const version = manifest.version;
const hostEvidenceName = `docs/host-validation-${version}.json`;
const hostEvidence = inputs[hostEvidenceName] ? JSON.parse(inputs[hostEvidenceName]) : null;
const hostVerified = hostEvidence?.schema === 1 && hostEvidence.version === version && hostEvidence.status === 'passed'
  && Object.keys(hostEvidence.runtimeSHA256 ?? {}).length === core.runtimeFiles.length
  && core.runtimeFiles.every(name => hostEvidence.runtimeSHA256[name] === runtimeHashes[name]);
const output = path.join(root, 'dist/candidates', version, archiveHash.slice(0, 16));
const evidence = path.join(root, '.research/candidates', version, sourceDigest);
const name = `Boot-Booster-${version}.zip`;
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(output, name), zipped);
fs.writeFileSync(path.join(output, name + '.sha256'), `${archiveHash}  ${name}\n`);
for (const [name, bytes] of Object.entries(inputs)) {
  const target = path.join(evidence, 'source', name);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
}
fs.writeFileSync(path.join(evidence, 'tests.tap'), tap);
fs.copyFileSync(path.join(root, 'dist/build-meta.json'), path.join(evidence, 'build-meta.json'));
const record = { schema: 2, version, date: new Date().toISOString(), status: 'local-candidate',
  purpose: 'Validate the current startup-optimization candidate with regression tests, strict lint and reproducible builds.',
  sourceDigest, sourceSHA256: { ...inputHashes, ...runtimeHashes }, runtimeSHA256: runtimeHashes,
  tests, reproducibleBuild: true, buildEnvironment: { node: process.version,
    typescript: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/typescript/package.json'))).version,
    esbuild: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/esbuild/package.json'))).version,
    obsidianTypes: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/obsidian/package.json'))).version },
  bundleInputs: Object.keys(meta.inputs).sort(), externalRuntimeImports: ['obsidian'],
  archive: { name, path: path.relative(root, path.join(output, name)).replaceAll('\\', '/'),
    sha256: archiveHash, bytes: zipped.length, files: ['main.js', 'manifest.json', 'styles.css', 'INSTALL.md'] },
  evidenceDirectory: path.relative(root, evidence).replaceAll('\\', '/'),
  hostValidation: { performed: hostVerified, performanceComparisonPerformed: hostVerified && hostEvidence.performanceComparisonPerformed === true, userTrialApproved: false,
    ...(hostVerified ? { evidence: hostEvidenceName, evidenceSHA256: inputHashes[hostEvidenceName], checks: hostEvidence.checks } : {}),
    ...(typeof hostEvidence?.previousVersion === 'string' ? { previousVersion: hostEvidence.previousVersion } : {}) },
  scope: { privateVaultAccess: false, published: false, distribution: 'private-trial' },
  limitations: [hostVerified ? 'Functional checks in a synthetic Android emulator only; no physical-device, IME or sync validation.' : 'No matching Android host evidence for this candidate.', 'Emulator timing samples are illustrative; physical-device startup speed and stability are unverified.',
    ...(pkg.license ? [] : ['License and public identity remain undecided.']), 'This is a private trial artifact; public distribution and submission require a separate decision.'] };
const json = JSON.stringify(record, null, 2) + '\n';
fs.writeFileSync(path.join(evidence, 'record.json'), json);
fs.writeFileSync(path.join(output, 'candidate-record.json'), json);
fs.writeFileSync(path.join(root, 'docs/validation-results.json'), json);
console.log(JSON.stringify({ version, tests: tests.passed, reproducibleBuild: true,
  archive: path.relative(root, path.join(output, name)).replaceAll('\\', '/'), sha256: archiveHash,
  hostValidationPerformed: hostVerified }, null, 2));
