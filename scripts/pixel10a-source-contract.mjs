import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
export const defaultLockPath = fileURLToPath(new URL('../android/aosp/pixel10a-source.json', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = value => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && value.split('/').every(p => p && p !== '.' && p !== '..');
function within(root, name) {
  if (!safe(name)) throw Error(`Unsafe source path: ${name}`);
  return path.join(root, name);
}
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function checkFile(root, entry) {
  const file = within(root, entry.path), stat = fs.lstatSync(file);
  if ('link' in entry) {
    if (!stat.isSymbolicLink() || fs.readlinkSync(file) !== entry.link) throw Error(`Source link differs: ${entry.path}`);
    const relative = path.relative(root, fs.realpathSync(file));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error(`Source link escapes tree: ${entry.path}`);
  } else {
    if (!stat.isFile() || stat.size !== entry.sizeBytes || await fileHash(file) !== entry.sha256) throw Error(`Source bytes differ: ${entry.path}`);
  }
}
function inventory(root, relative) {
  const found = [];
  for (const entry of fs.readdirSync(within(root, relative), {withFileTypes:true})) {
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...inventory(root, name));
    else found.push(name);
  }
  return found.sort();
}
async function git(root, args) {
  return (await exec('git', ['-C', root, ...args], {maxBuffer:64 * 1024 * 1024, env:{...process.env, GIT_OPTIONAL_LOCKS:'0'}})).stdout;
}
/** Verify the recorded development inputs. Does not modify source, admit an APK,
 * certify build outputs, or authorize a flash. Ignored build outputs are not inputs. */
export async function verifyPixel10aSource({source, factory, lock = defaultLockPath}) {
  if (!source || !factory) throw Error('Pixel 10a staging requires --aosp-source and --factory-image');
  const root = fs.realpathSync(source), bytes = fs.readFileSync(lock), contract = JSON.parse(bytes);
  if (contract.schema !== 1 || contract.target !== 'pixel10a' || contract.device?.codename !== 'stallion' || contract.device?.androidRelease !== '17' || contract.developmentOnly !== true || contract.releaseQualified !== false) throw Error('Not the Pixel 10a Android 17 development source contract');
  if (!contract.projects?.length || !contract.generated?.files?.length) throw Error('Incomplete Pixel 10a source inventory');
  const expectedFactory = contract.factory;
  if (!fs.statSync(factory).isFile() || fs.statSync(factory).size !== expectedFactory.sizeBytes || await fileHash(factory) !== expectedFactory.sha256) throw Error('Pixel 10a factory archive differs from the source lock');
  if ((await git(path.join(root, '.repo/manifests'), ['rev-parse','HEAD'])).trim() !== contract.manifest.commit) throw Error('AOSP manifest revision differs');
  const overrides = new Map();
  for (const entry of contract.overrides) {
    if (overrides.has(entry.path)) throw Error(`Duplicate override: ${entry.path}`);
    overrides.set(entry.path, entry);
  }
  const seen = new Set();
  // Bound filesystem pressure on a full AOSP checkout.
  let cursor = 0;
  await Promise.all(Array.from({length:8}, async () => {
    while (cursor < contract.projects.length) {
      const project = contract.projects[cursor++];
      if (seen.has(project.path)) throw Error(`Duplicate project: ${project.path}`);
      seen.add(project.path);
      const directory = within(root, project.path);
      if ((await git(directory, ['rev-parse','HEAD'])).trim() !== project.commit) throw Error(`Source revision differs: ${project.path}`);
      const flags = await git(directory, ['ls-files','-v','-z']);
      if (flags.split('\0').some(row => row && row[0] !== 'H')) throw Error(`Hidden or unresolved index entries: ${project.path}`);
      const changed = await git(directory, ['status','--porcelain=v1','-z','--untracked-files=all']);
      const actual = changed.split('\0').filter(Boolean).map(row => `${project.path}/${row.slice(3)}`).sort();
      const expected = [...overrides.keys()].filter(name => name.startsWith(`${project.path}/`)).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Unrecorded source changes: ${project.path}`);
      for (const name of expected) await checkFile(root, overrides.get(name));
    }
  }));
  const files = contract.generated.files;
  const expectedNames = files.map(entry => entry.path).sort();
  if (new Set(expectedNames).size !== files.length || files.some(entry => !entry.path.startsWith(`${contract.generated.root}/`))) throw Error('Invalid generated vendor inventory');
  if (JSON.stringify(inventory(root, contract.generated.root)) !== JSON.stringify(expectedNames)) throw Error('Generated vendor inventory differs');
  for (const entry of files) await checkFile(root, entry);
  return {schema:1, target:'pixel10a', codename:'stallion', sourceLockSha256:digest(bytes), manifestCommit:contract.manifest.commit, factorySha256:expectedFactory.sha256, projectsChecked:seen.size, overridesChecked:overrides.size, generatedFilesChecked:files.length, developmentOnly:true, imageBuilt:false, releaseQualified:false, deviceAcceptanceVerified:false};
}
