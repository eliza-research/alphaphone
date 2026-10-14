/** Installed voice turns with prerecorded WebRTC input; synthetic agent reply only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {openFixtureAudio} from './lib/cuttlefish-fixture-audio.mjs';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {parseInstrumentationArgs,runLeased,secondaryUserLifecycle} from './android-instrumentation.mjs';
import {acquireDeviceLease,deviceLeaseStateDir} from '../vendor/eliza/packages/app/scripts/lib/device-lease.ts';
const adbFor=serial=>(args,{timeout=120000,allowFailure=false}={})=>{const result=spawnSync('adb',['-s',serial,...args],{encoding:'utf8',timeout,maxBuffer:64<<20});if(!allowFailure&&(result.error||result.status!==0))throw Error(result.error?.message||result.stderr);return `${result.stdout||''}${allowFailure?result.stderr||'':''}`;};
if(!isMainThread){
 const {options,lease}=workerData,adb=adbFor(options.serial);
 try{const result=await runLeased({options,serial:options.serial,adb,withSecondaryUser:secondaryUserLifecycle({serial:options.serial,lease,imageFingerprint:options.imageFingerprint,adb})});parentPort.postMessage({result});}
 catch(error){parentPort.postMessage({error:String(error.stack||error)});}
}else{
 const args=process.argv.slice(2),extra={};
 for(const flag of ['--container','--device']){const index=args.indexOf(flag);if(index<0||!args[index+1])throw Error('Requires --container and --device');extra[flag.slice(2)]=args[index+1];args.splice(index,2);}
 if(args.some(a=>['--classes','--all','--test-mocks','--offline-speech'].includes(a)))throw Error('Only the production utterance campaign is supported');
 const options=parseInstrumentationArgs([...args,'--classes','LocalConversationUtterance']);
 if(!options.ownedCuttlefish||!/^127\.0\.0\.1:\d+$/.test(options.serial||'')||!options.output||!options.apkDir||!/^cvd-\d+$/.test(extra.device)||! /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(extra.container))throw Error('Explicit owned guest, image, APK archive and new output required');
 const lease=await acquireDeviceLease(`android:${options.serial}`,{waitMs:0,ttlMs:Number.MAX_SAFE_INTEGER,stateDir:deviceLeaseStateDir(process.env)});
 let log,chain=Promise.resolve(),feederError,workerOutcome,browser;const events=[];
 try{
  const inspect=JSON.parse(execFileSync('docker',['inspect',extra.container],{encoding:'utf8'}))[0],port=options.serial.split(':')[1];
  if(!inspect.State.Running||!Object.values(inspect.NetworkSettings.Ports).flat().some(p=>p?.HostIp==='127.0.0.1'&&p.HostPort===port))throw Error('Container does not own the ADB endpoint');
  const config=JSON.parse(execFileSync('docker',['exec',extra.container,'cat','/root/cuttlefish_assembly/cuttlefish_config.json'],{encoding:'utf8'}));
  const instance=Object.values(config.instances).find(v=>v.webrtc_device_id===extra.device&&String(v.adb_host_port)===port),adb=adbFor(options.serial);
  if(!instance||adb(['shell','getprop','ro.serialno']).trim()!==instance.serial_number||adb(['shell','getprop','ro.build.fingerprint']).trim()!==options.imageFingerprint)throw Error('Guest identities differ');
  const ip=Object.values(inspect.NetworkSettings.Networks)[0]?.IPAddress;if(!/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip||''))throw Error('Expected isolated Docker bridge');
  try{await fs.access(options.output);throw Error('Output already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const original=await fs.readFile(path.resolve('android/app/src/androidTest/assets/speech-fixture/0.wav')),fixtureSha256=createHash('sha256').update(original).digest('hex');
  // Establish the silent audio track before Android opens MediaRecorder. Trigger
  // one known waveform only on the current installed fixture's capture marker.
  browser=await openFixtureAudio({address:ip,device:extra.device,wav:original});
  const seen=new Set([...adb(['logcat','-d','-s','AlphaVoiceFixture:I','*:S']).matchAll(/CAPTURE_READY ([a-f0-9-]{36})/g)].map(match=>match[1]));let pending='';
  log=spawn('adb',['-s',options.serial,'logcat','-T','1','-v','brief','AlphaVoiceFixture:I','*:S']);
  log.stdout.on('data',chunk=>{pending+=chunk;let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);const id=line.match(/CAPTURE_READY ([a-f0-9-]{36})/)?.[1];if(!id||seen.has(id))continue;seen.add(id);
   chain=chain.then(async()=>{
    const event={id,fixtureSha256,transport:'preconnected-webaudio-pcm',readyAt:new Date().toISOString()};events.push(event);
    event.audioSettings=await browser.start();event.inputStartedAt=new Date().toISOString();console.log('Fixture PCM started for '+id);
    await browser.waitEnded();event.inputStoppedAt=new Date().toISOString();console.log('Fixture PCM ended for '+id);
   }).catch(error=>{feederError=String(error.stack||error);console.error('Fixture input failed: '+feederError);});
  }});
  log.on('error',error=>{feederError=String(error);});
  const worker=new Worker(new URL(import.meta.url),{workerData:{options,lease:{path:lease.path,lease:lease.lease}}});
  workerOutcome=await new Promise((resolve,reject)=>{let message;worker.on('message',value=>{message=value;});worker.on('error',reject);worker.on('exit',code=>code===0&&message?resolve(message):reject(Error('Instrumentation worker exited '+code)));});
  log.kill();await chain;await browser.close();browser=undefined;
  const result={kind:'controlled-virtual-voice-conversation',physicalMicrophone:false,realInference:false,containerId:inspect.Id,device:extra.device,browserClosed:true,events,...(feederError?{feederError}:{}),...workerOutcome};
  result.passed=!feederError&&workerOutcome.result?.passed===true&&events.length===options.variants.length&&events.every(e=>e.inputStoppedAt);
  await fs.writeFile(path.join(options.output,'audio-input.json'),JSON.stringify(result,null,2)+'\n');console.log(result.passed?'PASS controlled voice conversation':'FAIL controlled voice conversation');if(!result.passed)process.exitCode=1;
 }finally{log?.kill();await chain.catch(()=>{});await browser?.close();lease.release();}
}
