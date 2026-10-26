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
/** Verify the recorded source inputs. Does not modify source, admit an APK,
 * certify build outputs, or authorize a flash. Ignored build outputs are not inputs.
 * `developmentOnly` is reported from the lock; production staging separately requires it
 * to be false (pixel10aProductProblems). */
/**
 * Overrides contributed by reviewed, manifest-listed source patches (for example the SystemUI
 * listening chip, android/aosp/listener/systemui/chip/manifest.json). A patch is admitted only
 * on top of this exact lock (baselineLockSha256), its project's locked revision and its own
 * patch bytes; each file it adds or modifies must then match its recorded afterSha256.
 */
/** Reviewed source patches the Pixel 10a image applies on top of the lock (repository-relative manifests). */
export const PIXEL10A_SOURCE_PATCHES = Object.freeze(['android/aosp/listener/systemui/chip/manifest.json']);

/** Read admitted patch manifests and their patch bytes from the repository. */
export function loadAdmittedPatches(repoRoot, manifests = PIXEL10A_SOURCE_PATCHES) {
  return manifests.map(rel => {
    const file = path.resolve(repoRoot, rel), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {manifest, patchBytes: fs.readFileSync(path.join(path.dirname(file), manifest.patch))};
  });
}

export function admittedPatchOverrides(contract, lockSha256, patches = []) {
  const result = [];
  for (const {manifest, patchBytes} of patches) {
    if (manifest?.schema !== 1 || !Array.isArray(manifest.files)) throw Error('Invalid admitted source patch manifest');
    if (manifest.baselineLockSha256 !== lockSha256) throw Error(`Admitted patch for ${manifest.project} names another source lock baseline`);
    const project = contract.projects.find(entry => entry.path === manifest.project);
    if (!project || project.commit !== manifest.revision) throw Error(`Admitted patch for ${manifest.project} does not match the locked project revision`);
    if (createHash('sha256').update(patchBytes).digest('hex') !== manifest.patchSha256) throw Error(`Admitted patch bytes differ: ${manifest.project}/${manifest.patch}`);
    for (const file of manifest.files) {
      if (!/^[0-9a-f]{64}$/.test(file.afterSha256 ?? '') || typeof file.path !== 'string' || file.path.startsWith('/') || file.path.split('/').includes('..')) throw Error(`Invalid admitted patch file in ${manifest.project}`);
      result.push({path:`${manifest.project}/${file.path}`, sha256:file.afterSha256, patch:true});
    }
  }
  return result;
}
export async function verifyPixel10aSource({source, factory, lock = defaultLockPath, patches = []}) {
  if (!source || !factory) throw Error('Pixel 10a staging requires --aosp-source and --factory-image');
  const root = fs.realpathSync(source), bytes = fs.readFileSync(lock), contract = JSON.parse(bytes);
  if (contract.schema !== 1 || contract.target !== 'pixel10a' || contract.device?.codename !== 'stallion' || contract.device?.androidRelease !== '17' || typeof contract.developmentOnly !== 'boolean' || contract.releaseQualified !== false) throw Error('Not the Pixel 10a Android 17 source contract');
  if (!contract.projects?.length || !contract.generated?.files?.length) throw Error('Incomplete Pixel 10a source inventory');
  const expectedFactory = contract.factory;
  if (!fs.statSync(factory).isFile() || fs.statSync(factory).size !== expectedFactory.sizeBytes || await fileHash(factory) !== expectedFactory.sha256) throw Error('Pixel 10a factory archive differs from the source lock');
  const manifestRoot = path.join(root, '.repo/manifests');
  if ((await git(manifestRoot, ['rev-parse','HEAD'])).trim() !== contract.manifest.commit) throw Error('AOSP manifest revision differs');
  if ((await git(manifestRoot, ['ls-files','-v','-z'])).split('\0').some(row => row && row[0] !== 'H') || (await git(manifestRoot, ['status','--porcelain=v1','-z','--untracked-files=all'])).length) throw Error('AOSP manifest working tree differs');
  const configuration = contract.manifest.configuration;
  if (!Array.isArray(configuration) || !configuration.some(entry => entry.path === '.repo/manifest.xml') || !configuration.some(entry => entry.path === '.repo/project.list')) throw Error('Missing manifest configuration inventory');
  for (const entry of configuration) await checkFile(root, entry);
  const localRoot = '.repo/local_manifests';
  const actualLocal = fs.existsSync(path.join(root, localRoot)) ? inventory(root, localRoot) : [];
  const expectedLocal = configuration.filter(entry => entry.path.startsWith(`${localRoot}/`)).map(entry => entry.path).sort();
  if (JSON.stringify(actualLocal) !== JSON.stringify(expectedLocal)) throw Error('Local manifest inventory differs');
  const overrides = new Map();
  for (const entry of [...contract.overrides, ...admittedPatchOverrides(contract, digest(bytes), patches)]) {
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
      for (const name of expected) {
        const entry = overrides.get(name);
        if (entry.patch) { if (await fileHash(within(root, name)) !== entry.sha256) throw Error(`Admitted patch bytes differ in tree: ${name}`); }
        else await checkFile(root, entry);
      }
      // git status hides ignored source. Bind even ignored extraction-tool outputs;
      // a new ignored Android.bp or source file must not silently enter the build.
      const ignored = (await git(directory, ['ls-files','--others','--ignored','--exclude-standard','-z'])).split('\0').filter(Boolean).map(name => `${project.path}/${name}`).sort();
      const expectedIgnored = (contract.ignoredInputs ?? []).find(entry => entry.project === project.path);
      if (ignored.length !== (expectedIgnored?.files ?? 0)) throw Error(`Ignored source inventory differs: ${project.path}`);
      if (ignored.length) {
        const tree = createHash('sha256');
        for (const name of ignored) {
          const file = within(root, name), stat = fs.lstatSync(file);
          const record = stat.isSymbolicLink() ? {path:name, link:fs.readlinkSync(file)} : {path:name, sizeBytes:stat.size, sha256:await fileHash(file)};
          if (!stat.isSymbolicLink() && !stat.isFile()) throw Error(`Invalid ignored source input: ${name}`);
          tree.update(JSON.stringify(record)+'\n');
        }
        if (tree.digest('hex') !== expectedIgnored.sha256) throw Error(`Ignored source bytes differ: ${project.path}`);
      }
    }
  }));
  const files = contract.generated.files;
  const expectedNames = files.map(entry => entry.path).sort();
  if (new Set(expectedNames).size !== files.length || files.some(entry => !entry.path.startsWith(`${contract.generated.root}/`))) throw Error('Invalid generated vendor inventory');
  if (JSON.stringify(inventory(root, contract.generated.root)) !== JSON.stringify(expectedNames)) throw Error('Generated vendor inventory differs');
  for (const entry of files) await checkFile(root, entry);
  return {schema:1, target:'pixel10a', codename:'stallion', sourceLockSha256:digest(bytes), manifestCommit:contract.manifest.commit, factorySha256:expectedFactory.sha256, projectsChecked:seen.size, overridesChecked:overrides.size, admittedPatches:patches.map(({manifest}) => ({project:manifest.project, patchSha256:manifest.patchSha256})), generatedFilesChecked:files.length, developmentOnly:contract.developmentOnly, imageBuilt:false, releaseQualified:false, deviceAcceptanceVerified:false};
}
