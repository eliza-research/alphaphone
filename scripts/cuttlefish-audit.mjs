#!/usr/bin/env node
/** Audit the installed AOSP image, using a disposable secondary user for tests.
 * Does not replace the system APK or modify user 0's application data.
 * ANDROID_SERIAL=127.0.0.1:6520 node scripts/cuttlefish-audit.mjs OUTPUT [--run]
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {admitCuttlefish, instrumentationResult} from './cuttlefish-contract.mjs';
const [output, mode] = process.argv.slice(2);
if (!output || (mode && mode !== '--run')) throw Error('Usage: OUTPUT [--run]');
const serial = process.env.ANDROID_SERIAL;
if (!/^(?:127\.0\.0\.1|localhost):\d{2,5}$/.test(serial || '')) throw Error('Explicit loopback ANDROID_SERIAL required');
const adb = process.env.ADB || 'adb';
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], {encoding: 'utf8', timeout: args.includes('instrument') ? 900000 : args.includes('create-user') ? 120000 : 30000, maxBuffer: 32*1024*1024});
const prop = name => run('shell', 'getprop', name).trim();
const image = admitCuttlefish(serial, {hardware: prop('ro.hardware'), device: prop('ro.product.device'), bootCompleted: prop('sys.boot_completed'), fingerprint: prop('ro.build.fingerprint'), abi: prop('ro.product.cpu.abi'), buildType: prop('ro.build.type')});
const app = JSON.parse(fs.readFileSync('app.config.json')).appId;
const packages = [app, app + '.test'];
const installed = packages.map(name => {
  const locations = run('shell', 'pm', 'path', name).trim().split(/\r?\n/);
  if (!locations.length || locations.some(v => !/^package:\/[\w./+=~-]+\.apk$/.test(v))) throw Error(`Installed APK required: ${name}`);
  return {name, apks: locations.map(v => ({path: v.slice(8), sha256: run('shell', 'sha256sum', v.slice(8)).trim().split(/\s+/)[0]}))};
});
fs.mkdirSync(output, {recursive:false});
const report = {createdAt: new Date().toISOString(), serial, image, installed, scope: 'Installed AOSP image only; independent of current-checkout APK build and physical hardware acceptance', webview: run('shell', 'dumpsys', 'webviewupdate'), tests: null, status: 'inventoried'};
const save = () => fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report,null,2)+'\n');
save();
if (mode === '--run') {
  const original = run('shell', 'am', 'get-current-user').trim();
  if (!/^\d+$/.test(original)) throw Error('Unknown foreground user');
  if(run('shell','am','get-started-user-state',original).trim()!=='RUNNING_UNLOCKED')throw Error('Foreground user is not fully unlocked; do not create fixtures');
  const name = 'alpha-audit-' + randomUUID();
  let user;
  report.fixture = {name, original, phase:'creating'}; save();
  try {
    const created = run('shell', 'pm', 'create-user', name);
    user = /Success: created user id (\d+)/.exec(created)?.[1];
    if (!user || user === '0') throw Error('Disposable user creation failed');
    report.fixture = {user, name, original}; save();
    for (const pkg of packages) run('shell','cmd','package','install-existing','--user',user,pkg);
    run('shell','am','switch-user',user);
    const deadline = Date.now()+30000;
    while (Date.now()<deadline) {
      if (run('shell','am','get-current-user').trim()===user && run('shell','am','get-started-user-state',user).trim()==='RUNNING_UNLOCKED') break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if (run('shell','am','get-current-user').trim()!==user || run('shell','am','get-started-user-state',user).trim()!=='RUNNING_UNLOCKED') throw Error('Fixture did not become foreground/unlocked');
    // No provider credentials, real mail, alarm delivery or paid provisioning.
    const classes = ['ShellInstrumentedTest','PrototypeFlowInstrumentedTest'].map(c=>app+'.'+c).join(',');
    const log = run('shell','am','instrument','--user',user,'-w','-r','-e','class',classes,app+'.test/androidx.test.runner.AndroidJUnitRunner');
    fs.writeFileSync(path.join(output,'instrumentation.txt'),log);
    report.tests=instrumentationResult(log);
    report.status=report.tests.passed?'passed-with-separate-integration-gates':'failed';
  } catch(error) {
    if(error.stdout)fs.writeFileSync(path.join(output,'instrumentation-partial.txt'),error.stdout);
    report.status='failed'; report.error=String(error.message).slice(0,1000);
  } finally {
    // A timed-out create may have committed. Recover only our unique name.
    if (!user) {
      try {
        const matches=[...run('shell','pm','list','users').matchAll(/UserInfo\{(\d+):([^:}]+):/g)].filter(m=>m[2]===name);
        if(matches.length===1 && matches[0][1]!=='0') user=matches[0][1];
      } catch { report.cleanup='User inventory unavailable; inspect the recorded fixture name'; }
    }
    if (user) {
      try {
        if(run('shell','am','get-current-user').trim()!==original)run('shell','am','switch-user',original);
        const restoreDeadline=Date.now()+30000;
        while(run('shell','am','get-current-user').trim()!==original && Date.now()<restoreDeadline)await new Promise(resolve=>setTimeout(resolve,500));
        if(run('shell','am','get-current-user').trim()!==original)throw Error('Foreground restoration unconfirmed');
        const inventory=run('shell','pm','list','users');
        if(!inventory.includes(`UserInfo{${user}:${name}:`))throw Error('Fixture ownership changed; preserving user');
        run('shell','am','stop-user','-w','-f',user);
        if(!/^Success: removed user\s*$/.test(run('shell','pm','remove-user',user).trim()) || run('shell','pm','list','users').includes(`UserInfo{${user}:`))throw Error('Fixture removal unconfirmed');
        report.cleanup='restored original user; removed owned fixture';
      }catch(error){report.cleanup=error.message;report.status='failed';}
    }
    save();
  }
}
console.log(JSON.stringify({status:report.status, counts:report.tests?.counts, output},null,2));
if(report.status==='failed')process.exitCode=1;
