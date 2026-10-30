import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseNativeBlobBatch, upstreamNativeSource } from './upstream-native-source.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeName = name => typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..');
function regular(filename, directory = false) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw Error('Nonregular browser consumer path: ' + filename);
  return stat;
}
function inventory(directory) {
  regular(directory, true);
  const result = Object.create(null);
  let total = 0;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) { regular(filename, true); visit(filename); continue; }
      const stat = regular(filename);
      total += stat.size;
      if (total > 512 * 1024 * 1024 || Object.keys(result).length >= 20000) throw Error('Browser consumer exceeds artifact bounds');
      const name = path.relative(directory, filename).split(path.sep).join('/');
      if (!safeName(name)) throw Error('Invalid browser consumer filename');
      result[name] = { bytes: stat.size, sha256: digest(fs.readFileSync(filename)) };
    }
  }
  visit(directory);
  return result;
}
function sameFiles(actual, expected) {
  return Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([name, value]) => safeName(name) && plain(value) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && /^[a-f0-9]{64}$/.test(value.sha256) && actual[name]?.bytes === value.bytes && actual[name]?.sha256 === value.sha256);
}

/** Inspect the actual emitted artifact, never its source projection or a diagnostic build. */
export function inspectBrowserConsumer(directory, source) {
  const actual = inventory(directory);
  if (!actual['manifest.json'] || actual['manifest.json'].bytes > 16 * 1024 * 1024) throw Error('Missing or oversized browser consumer manifest');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 'eliza-browser-consumer-v1' || manifest.revision !== source.pin || manifest.distributable !== true || manifest.diagnostic !== false || manifest.sourceDiffSha256 !== digest('')) throw Error('Browser consumer is not a clean production build of the pinned source');
  if (manifest.entry !== 'index.js' || manifest.types !== 'index.d.ts' || manifest.stylesEntry !== 'styles.js') throw Error('Unsupported browser consumer entry contract');
  for (const name of [manifest.entry, manifest.types, manifest.stylesEntry, ...[manifest.prebootEntry, manifest.prebootTypes].filter(Boolean)]) if (!safeName(name) || !actual[name]?.bytes) throw Error('Missing browser consumer entry');
  if (!Array.isArray(manifest.styles) || manifest.styles.length !== 1 || !safeName(manifest.styles[0]) || !manifest.styles[0].endsWith('.css') || !actual[manifest.styles[0]]?.bytes) throw Error('Missing canonical browser consumer stylesheet');
  if (!Array.isArray(manifest.runtimeImports) || !manifest.runtimeImports.every(value => /^(react|react-dom|@capacitor\/core)(\/.*)?$/.test(value))) throw Error('Browser consumer has an unsupported runtime dependency');
  if (!Array.isArray(manifest.staticAssets) || !manifest.staticAssets.every(name => safeName(name) && Object.hasOwn(actual, 'public/' + name))) throw Error('Invalid browser consumer public assets');
  delete actual['manifest.json'];
  if (!plain(manifest.files) || !sameFiles(actual, manifest.files)) throw Error('Browser consumer file inventory does not match its manifest');
  source.verify(manifest);
  return { manifest, manifestSha256: digest(fs.readFileSync(path.join(directory, 'manifest.json'))) };
}

function pinnedSource(root) {
  const upstream = upstreamNativeSource(root);
  const git = (...args) => execFileSync('git', ['-C', upstream.directory, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return { pin: upstream.pin, verify(manifest) {
    if (manifest.lockSha256 !== digest(git('show', upstream.pin + ':bun.lock'))) throw Error('Browser consumer dependency lock differs from the pinned source');
    if (!plain(manifest.sourceFiles)) throw Error('Missing browser consumer source receipt');
    const tracked = new Map(git('ls-tree', '-r', '-z', upstream.pin).toString().split('\0').filter(Boolean).map(line => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      return match ? [match[3], match[2]] : [line.split('\t')[1], null];
    }));
    for (const required of ['packages/app/scripts/build-browser-consumer.ts', 'packages/app/src/renderer/browser-consumer.tsx']) if (!tracked.get(required) || !manifest.sourceFiles[required]) throw Error('Missing canonical application source receipt');
    const inputs = [];
    for (const [name, expected] of Object.entries(manifest.sourceFiles)) {
      if (!safeName(name) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid browser consumer source receipt');
      if (tracked.has(name)) {
        if (!tracked.get(name)) throw Error('Nonregular browser consumer source');
        inputs.push([name, tracked.get(name), expected]);
      }
    }
    // Keep Git's binary batch bounded even when the complete emitted graph is large.
    for (let offset = 0; offset < inputs.length; offset += 64) {
      const batch = inputs.slice(offset, offset + 64), oids = batch.map(item => item[1]);
      const bytes = parseNativeBlobBatch(execFileSync('git', ['-C', upstream.directory, 'cat-file', '--batch'], { input: oids.join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 }), oids);
      batch.forEach(([name, , expected], index) => { if (digest(bytes[index]) !== expected) throw Error('Browser consumer source differs from pin: ' + name); });
    }
  }};
}

export function prepareBrowserConsumer(root = projectRoot, input = process.env.ELIZA_BROWSER_CONSUMER_DIR) {
  const source = pinnedSource(root);
  const parent = path.join(root, '.eliza'), destination = path.join(parent, 'browser-consumer');
  if (fs.existsSync(parent)) regular(parent, true);
  if (!input) {
    if (fs.existsSync(destination)) { inspectBrowserConsumer(destination, source); return destination; }
    throw Error('A pinned production App artifact is required. Build packages/app with build:browser-consumer, then run ELIZA_BROWSER_CONSUMER_DIR=/path/to/artifact npm run upstream:prepare-app.');
  }
  const from = path.resolve(input), receipt = inspectBrowserConsumer(from, source);
  if (from === destination) return destination;
  if (destination.startsWith(from + path.sep) || from.startsWith(destination + path.sep)) throw Error('Browser consumer input overlaps its destination');
  if (fs.existsSync(destination)) {
    regular(destination, true);
    regular(path.join(destination, 'manifest.json'));
    if (JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8')).schema !== 'eliza-browser-consumer-v1') throw Error('Refusing to replace an unrecognized browser consumer directory');
  }
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, 'browser-consumer-stage-'));
  try {
    for (const name of [...Object.keys(receipt.manifest.files), 'manifest.json']) {
      const filename = path.join(temporary, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.copyFileSync(path.join(from, name), filename);
    }
    const staged = inspectBrowserConsumer(temporary, source);
    if (staged.manifestSha256 !== receipt.manifestSha256) throw Error('Browser consumer changed during staging');
    const backup = fs.existsSync(destination) ? fs.mkdtempSync(path.join(parent, 'browser-consumer-previous-')) : null;
    if (backup) { fs.rmdirSync(backup); fs.renameSync(destination, backup); }
    try { fs.renameSync(temporary, destination); }
    catch (error) { if (backup) fs.renameSync(backup, destination); throw error; }
    if (backup) fs.rmSync(backup, { recursive: true });
    return destination;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('Production browser App prepared: ' + prepareBrowserConsumer());
