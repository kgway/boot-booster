const { createHash } = require('node:crypto');
const { deflateRawSync } = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const runtimeFiles = ['main.js', 'manifest.json', 'styles.css'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

function readInputs(root) {
  const names = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    'esbuild.config.mjs', 'docs/test.cjs', 'docs/check-text.cjs', 'docs/editing-text.md', 'docs/candidate-core.cjs', 'docs/prepare-candidate.mjs',
    'docs/package.ps1', 'docs/package-release.py', 'docs/candidate-install.md', 'README.md', 'README.ja.md', 'CHANGELOG.md',
    'manifest.json', 'styles.css'];
  for (const name of ['VALIDATION.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'versions.json', 'docs/check-release.cjs',
    'docs/export-public.mjs', 'docs/public-files.json', 'docs/testing.md', 'docs/publishing.md', 'docs/releasing.md', 'docs/verify-release.mjs', 'eslint.config.mjs', 'docs/lint.cjs', '.gitattributes', '.gitignore', '.github/workflows/check.yml', '.github/workflows/release-build.yml']) {
    if (fs.existsSync(path.join(root, name))) names.push(name);
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
  const hostEvidence = `docs/host-validation-${version}.json`;
  if (fs.existsSync(path.join(root, hostEvidence))) names.push(hostEvidence);
  const walk = dir => {
    for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
      const relative = `${dir}/${name}`, info = fs.lstatSync(path.join(root, relative));
      if (info.isSymbolicLink()) throw Error(`Symlink in source: ${relative}`);
      if (info.isDirectory()) walk(relative); else if (name.endsWith('.ts') || /^src\/locales\/(ja|en)\.json$/.test(relative)) names.push(relative);
    }
  };
  for (const dir of ['src', 'tests']) walk(dir);
  const files = {};
  for (const name of names.sort()) {
    const full = path.resolve(root, name);
    if (fs.lstatSync(full).isSymbolicLink() || !fs.lstatSync(full).isFile()) throw Error(`Invalid input: ${name}`);
    files[name] = fs.readFileSync(full);
  }
  return files;
}

function hashes(files) {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => [name, sha256(bytes)]));
}

function checkRuntime(files, manifest, pkg, meta) {
  if (manifest.id !== 'boot-booster' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version !== pkg.version) throw Error('Manifest/package mismatch');
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify([...runtimeFiles].sort())) throw Error('Unexpected runtime files');
  if (!Object.keys(meta.inputs).length || Object.keys(meta.inputs).some(name => !(name.startsWith('src/') && name.endsWith('.ts')) && !/^src\/locales\/(ja|en)\.json$/.test(name))) throw Error('Unexpected bundle inputs');
  if (Object.values(meta.outputs).some(out => out.imports.some(item => !item.external || item.path !== 'obsidian'))) throw Error('Unexpected runtime import');
  for (const [name, bytes] of Object.entries(files)) {
    if (/(?:[a-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)/i.test(bytes.toString('utf8'))) throw Error(`Personal path in ${name}`);
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamp, UTF-8 names and no host paths or extras make this ZIP reproducible.
function createZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (!/^boot-booster\/(?:main\.js|manifest\.json|styles\.css|INSTALL\.md)$/.test(name)) throw Error('Unexpected archive entry');
    const filename = Buffer.from(name, 'utf8'), packed = deflateRawSync(data), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, filename); offset += header.length + filename.length + packed.length;
  }
  if (local.length !== 12) throw Error('Missing archive entry');
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(4, 8); end.writeUInt16LE(4, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

module.exports = { runtimeFiles, sha256, readInputs, hashes, checkRuntime, createZip, crc32 };
