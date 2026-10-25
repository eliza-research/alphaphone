/** Read-only preparation audit. Deliberately cannot authorize or execute a flash. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function parseOptions(args) {
  const options = {};
  for (let i=0; i<args.length; i++) {
    const key=args[i];
    if (!['--device','--factory','--output','--mode'].includes(key) || options[key.slice(2)] !== undefined || !args[i+1] || args[i+1].startsWith('--')) throw Error('Use [--device SERIAL --mode adb|fastboot] [--factory FILE] [--output NEW_FILE]');
    options[key.slice(2)]=args[++i];
  }
  if (options.mode && !options.device) throw Error('--mode requires --device');
  options.mode ??= 'adb';
  if (!['adb','fastboot'].includes(options.mode)) throw Error('Unsupported mode');
  if (options.device && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.device)) throw Error('Invalid explicit device serial');
  return options;
}
export async function verifyFactory(file, pin) {
  const handle=await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before=await handle.stat();
    if (!before.isFile() || before.size !== pin.sizeBytes) throw Error('Factory archive must be a regular file with the exact pinned size');
    const hash=createHash('sha256');
    for await (const chunk of handle.createReadStream({autoClose:false})) hash.update(chunk);
    const after=await handle.stat(), named=await fs.promises.lstat(file);
    const digest=hash.digest('hex');
    const stable=state=>state.isFile() && !state.isSymbolicLink() && ['dev','ino','size','mtimeMs','ctimeMs'].every(key=>before[key]===state[key]);
    if (digest !== pin.sha256 || !stable(after) || !stable(named)) throw Error('Factory archive hash mismatch or file changed during verification');
    return {sha256:digest,sizeBytes:before.size,integrity:'verified',restorationTested:false};
  } finally {
    await handle.close();
  }
}
const properties=['ro.product.device','ro.product.model','ro.boot.hardware.sku','ro.build.fingerprint','ro.build.id','ro.bootloader','gsm.version.baseband','ro.boot.slot_suffix','ro.boot.flash.locked','ro.boot.verifiedbootstate','ro.crypto.state','sys.boot_completed'];
const variables=['product','sku','version-bootloader','version-baseband','current-slot','unlocked','is-userspace','snapshot-update-status','slot-successful:a','slot-successful:b','slot-unbootable:a','slot-unbootable:b','battery-soc'];
export function readDevice(serial, mode, run=spawnSync) {
  parseOptions(['--device', serial, '--mode', mode]);
  // No discovery, shell scripts, getvar all, reboot, unlock, root, or writes.
  const facts={},errors=[];
  for (const key of mode==='adb'?properties:variables) {
    const args=['-s',serial,...(mode==='adb'?['shell','getprop',key]:['getvar',key])];
    const result=run(mode,args,{encoding:'utf8',timeout:10000,maxBuffer:16384});
    if (result.error || result.status !== 0) { errors.push(`${key}: read failed`); continue; }
    const output=mode==='adb'?result.stdout:`${result.stdout || ''}\n${result.stderr || ''}`;
    if (mode==='fastboot' && /(?:FAILED|error:|remote failure)/i.test(output)) { errors.push(`${key}: protocol failure`); continue; }
    const values=mode==='adb'?[output.trim()]:output.split(/\r?\n/).map(s=>s.replace(/^\(bootloader\)\s*/, '')).filter(s=>s.startsWith(key+':')).map(s=>s.slice(key.length+1).trim());
    if (values.length!==1 || !values[0] || values[0].length>512 || /[\r\n\x00-\x1f]/.test(values[0])) errors.push(`${key}: missing or ambiguous value`);
    else facts[key]=values[0];
  }
  return {mode,serialSha256:sha(serial),facts,errors,scope:'read-only observation; no boot or recovery qualification'};
}
export function evaluateDevice(observation, lock) {
  if (!observation) return ['No physical Pixel 11 Pro observation supplied.'];
  const f=observation.facts, adb=observation.mode==='adb', reasons=[...observation.errors];
  if (f[adb?'ro.product.device':'product']!=='grizzly') reasons.push('Device is not grizzly (Pixel 11 Pro); XL, Fold, emulator and Cuttlefish are not substitutes.');
  if (!['G7SWN','GM45K'].includes(f[adb?'ro.boot.hardware.sku':'sku'])) reasons.push('Unknown Pixel 11 Pro SKU.');
  const required=lock.generatedVendor.requiredTextFiles.find(x=>x.path.endsWith('firmware/android-info.txt')).includes;
  for (const [field,prefix] of [[adb?'ro.bootloader':'version-bootloader','require version-bootloader='],[adb?'gsm.version.baseband':'version-baseband','require version-baseband=']]) {
    const expected=required.find(x=>x.startsWith(prefix))?.slice(prefix.length);
    if (!expected || f[field]!==expected) reasons.push(`${field} does not match the pinned firmware; no downgrade or firmware transition is authorized.`);
  }
  if (adb) {
    if (f['ro.build.id']!==lock.device.buildId || !f['ro.build.fingerprint']?.startsWith(`google/grizzly/grizzly:17/${lock.device.buildId}/`)) reasons.push('Stock build/fingerprint differs from the pinned B1 baseline.');
    if (f['sys.boot_completed']!=='1') reasons.push('Android has not completed boot.');
    reasons.push('Bootloader slot health, snapshot state, geometry, battery and rollback compatibility remain unobserved in adb mode.');
  } else {
    if (f['is-userspace']!=='no') reasons.push('Observation is not bootloader fastboot.');
    if (f['snapshot-update-status']!=='none') reasons.push('Snapshot state is pending or unknown.');
    if (!['a','b'].includes(f['current-slot'])) reasons.push('Current slot is unknown.');
    for (const slot of ['a','b']) if(f[`slot-successful:${slot}`]!=='yes'||f[`slot-unbootable:${slot}`]!=='no') reasons.push(`Slot ${slot} is not confirmed successful and bootable.`);
    const battery=/^(\d+) %$/.exec(f['battery-soc']||'');
    if (!battery || Number(battery[1])<50 || Number(battery[1])>100) reasons.push('Battery is below preparation threshold (50%) or unknown.');
    reasons.push('Stock Android identity, encryption, geometry and rollback compatibility still require qualification.');
  }
  return reasons;
}
export async function audit(options, repo=root, run=spawnSync) {
  const osRoot=path.join(repo,'vendor/eliza/packages/os');
  const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const pin=read(path.join(repo,'upstream.lock.json'));
  const lockFile=path.join(osRoot,'android/pixel11pro.lock.json'), lock=read(lockFile);
  const target=read(path.join(osRoot,'android/hardware-targets.json')).targets.find(t=>t.targetId==='pixel11pro-grizzly');
  const trust=read(path.join(osRoot,'android/release-trust.json'));
  const blockers=[];
  const git=run('git',['-C',path.join(repo,'vendor/eliza'),'rev-parse','HEAD'],{encoding:'utf8',timeout:10000});
  if (git.status!==0 || git.stdout.trim()!==pin.commit) blockers.push('Upstream checkout does not match product pin.');
  const dirty=run('git',['-C',path.join(repo,'vendor/eliza'),'status','--porcelain','--untracked-files=normal'],{encoding:'utf8',timeout:10000});
  if (dirty.status!==0 || dirty.stdout.trim()) blockers.push('Upstream checkout is dirty or unreadable.');
  for (const ref of [lock.resolvedManifest,lock.generatedVendor.referenceSpec]) {
    const file=path.resolve(osRoot,ref.path);
    if (!file.startsWith(osRoot+path.sep) || sha(fs.readFileSync(file))!==ref.sha256) blockers.push(`Source lock digest mismatch: ${ref.path}`);
  }
  if (!target?.installerEligible) blockers.push('Upstream hardware inventory denies OS installation.');
  if (!target?.labExperimentsEligible) blockers.push('Upstream hardware inventory denies lab flashing.');
  blockers.push(...(target?.blockedReasons||[]));
  if (!trust.keys?.length) blockers.push('Release trust has no enrolled signing keys.');
  let recovery={integrity:'not-checked',restorationTested:false};
  if(options.factory) {try{recovery=await verifyFactory(options.factory,lock.rollbackFactoryImage);}catch(e){blockers.push(e.message);}}
  else blockers.push('Pinned stock restoration archive has not been supplied and hash-verified locally.');
  const device=options.device?readDevice(options.device,options.mode,run):null;
  blockers.push(...evaluateDevice(device,lock));
  // This consumer has an APK overlay, not an admitted Alpha physical release.
  blockers.push('No Alpha-specific signed physical release, complete image validation and exact-device boot/recovery acceptance are admitted by this audit.');
  return {schemaVersion:1,observedAt:new Date().toISOString(),product:'alphaphone',target:'pixel11pro-grizzly',deployReady:false,execution:false,upstreamCommit:pin.commit,sourceLockSha256:sha(fs.readFileSync(lockFile)),baseline:{aosp:lock.manifestRevision,buildId:lock.device.buildId,factory:lock.rollbackFactoryImage},device,recovery,blockers:[...new Set(blockers)],boundary:'Preparation only. APKs, host tests and archive hashes do not prove image boot, anti-rollback compatibility or stock restoration.'};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options=parseOptions(process.argv.slice(2));
    const report=await audit(options), bytes=JSON.stringify(report,null,2)+'\n';
    if(options.output)fs.writeFileSync(options.output,bytes,{flag:'wx',mode:0o600});
    console.log(bytes); process.exitCode=2;
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
