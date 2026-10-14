/** Owned Cuttlefish WebRTC -> VirtIO capture probe. Never opens a host microphone. */
import {openFixtureAudio} from './lib/cuttlefish-fixture-audio.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {acquireDeviceLease,deviceLeaseStateDir} from '../vendor/eliza/packages/app/scripts/lib/device-lease.ts';
const options={};
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i];if(key==='--owned-cuttlefish'){options.owned=true;continue;}
 if(!['--container','--serial','--device','--image-fingerprint','--output','--capture-rate','--period-size','--period-count'].includes(key)||!process.argv[i+1])throw Error('Required: --owned-cuttlefish --container NAME --serial 127.0.0.1:PORT --device cvd-N --image-fingerprint VALUE --output NEW_DIRECTORY');
 options[key.slice(2)]=process.argv[++i];
}
if(!options.owned||!/^127\.0\.0\.1:\d+$/.test(options.serial||'')||!/^cvd-\d+$/.test(options.device||'')||!/^[-a-zA-Z0-9_.]+$/.test(options.container||'')||options.container.startsWith('-')||!options['image-fingerprint']||!options.output)throw Error('Explicit owned guest identity and new output directory required');
const captureRate=options['capture-rate']??'48000';if(!['16000','48000'].includes(captureRate))throw Error('Capture rate must be 16000 or 48000');
const periodSize=options['period-size']??'1024',periodCount=options['period-count']??'4';
if(!/^[1-9][0-9]*$/.test(periodSize)||Number(periodSize)<64||Number(periodSize)>8192||!['2','3','4','5','6','7','8'].includes(periodCount))throw Error('Period size must be 64–8192 frames and count 2–8');
const run=promisify(execFile),execute=async(cmd,args,timeout=15000)=>(await run(cmd,args,{timeout,maxBuffer:1024*1024})).stdout;
const adb=args=>execute('adb',['-s',options.serial,...args],25000);
const lease=await acquireDeviceLease(`android:${options.serial}`,{waitMs:0,ttlMs:Number.MAX_SAFE_INTEGER,stateDir:deviceLeaseStateDir(process.env)});
let browser,remote,capture;
const report={kind:'cuttlefish-virtual-microphone',physicalMicrophone:false,asrVerified:false,captureRate:Number(captureRate),periodSize:Number(periodSize),periodCount:Number(periodCount),passed:false};
let outputCreated=false;
try{
 const [container]=JSON.parse(await execute('docker',['inspect',options.container]));
 if(!container.State.Running)throw Error('Owned container is stopped');
 const port=options.serial.split(':')[1];
 if(!Object.values(container.NetworkSettings.Ports).flat().some(p=>p?.HostIp==='127.0.0.1'&&p.HostPort===port))throw Error('ADB address is not bound to this container');
 const config=JSON.parse(await execute('docker',['exec',options.container,'cat','/root/cuttlefish_assembly/cuttlefish_config.json']));
 const instance=Object.values(config.instances).find(v=>v.webrtc_device_id===options.device&&String(v.adb_host_port)===port);
 if(!instance||(await adb(['shell','getprop','ro.serialno'])).trim()!==instance.serial_number)throw Error('ADB and WebRTC do not identify the same guest');
 const fingerprint=(await adb(['shell','getprop','ro.build.fingerprint'])).trim();
 if(fingerprint!==options['image-fingerprint']||(await adb(['shell','getprop','ro.hardware'])).trim()!=='cutf_cvm')throw Error('Guest image identity differs');
 const address=Object.values(container.NetworkSettings.Networks)[0]?.IPAddress;
 if(!/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(address||''))throw Error('Expected an isolated Docker bridge address');
 await fs.mkdir(options.output,{recursive:false});outputCreated=true;
 const fixture=path.resolve('android/app/src/androidTest/assets/speech-fixture/0.wav');
 report.containerId=container.Id;report.device=options.device;report.imageFingerprint=fingerprint;report.fixtureSha256=createHash('sha256').update(await fs.readFile(fixture)).digest('hex');
 browser=await openFixtureAudio({address,device:options.device,wav:await fs.readFile(fixture)});
 remote='/data/local/tmp/alpha-audio-probe-'+randomUUID()+'.wav';
 capture=adb(['shell','su','0','tinycap',remote,'-D','0','-d','0','-c','1','-r',captureRate,'-b','16','-p',periodSize,'-n',periodCount,'-T','10']);
 void capture.catch(()=>{});
 // Start the known waveform after capture admission, over an already-live peer.
 await new Promise(resolve=>setTimeout(resolve,300));
 report.audioSettings=await browser.start();
 report.captureLog=await capture;await browser.waitEnded();
 const destination=path.join(options.output,'capture.wav');await adb(['pull',remote,destination]);
 const captured=await fs.readFile(destination);report.captureSha256=createHash('sha256').update(captured).digest('hex');
 function envelope(bytes){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Invalid WAV');
  let rate,data;
  for(let i=12;i+8<=bytes.length;){const name=bytes.toString('ascii',i,i+4),n=bytes.readUInt32LE(i+4),start=i+8;if(start+n>bytes.length)throw Error('Truncated WAV');
   if(name==='fmt '){if(bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||bytes.readUInt16LE(start+14)!==16)throw Error('Expected PCM mono16');rate=bytes.readUInt32LE(start+4);}
   if(name==='data')data=bytes.subarray(start,start+n);i=start+n+(n%2);
  }
  if(!rate||!data)throw Error('Incomplete WAV');const width=rate/100;if(!Number.isInteger(width))throw Error('Unsupported sample rate');
  const values=[];for(let i=0;i+width*2<=data.length;i+=width*2){let sum=0;for(let j=0;j<width;j++){const v=data.readInt16LE(i+j*2);sum+=v*v;}values.push(Math.sqrt(sum/width));}return {values,seconds:data.length/2/rate,rate};
 }
 const wholeReference=envelope(await fs.readFile(fixture)).values,actual=envelope(captured);
 if(actual.rate!==Number(captureRate))throw Error('Capture sample rate differs from request');
 if(actual.seconds<9||actual.seconds>12)throw Error('Unexpected capture duration');
 function correlate(reference){
 const mean=reference.reduce((a,b)=>a+b,0)/reference.length,variance=reference.reduce((a,b)=>a+(b-mean)**2,0);let best=-1,offset=0;
 for(let i=0;i+reference.length<=actual.values.length;i++){const segment=actual.values.slice(i,i+reference.length),m=segment.reduce((a,b)=>a+b,0)/segment.length;let dot=0,v=0;for(let j=0;j<segment.length;j++){dot+=(segment[j]-m)*(reference[j]-mean);v+=(segment[j]-m)**2;}const correlation=v?dot/Math.sqrt(v*variance):0;if(correlation>best){best=correlation;offset=i*10;}}
 return {best,offset};
 }
 const first=correlate(wholeReference.slice(0,300)),whole=correlate(wholeReference);
 report.durationSeconds=actual.seconds;report.firstThreeSecondsEnvelopeCorrelation=first.best;report.segmentOffsetMs=first.offset;report.wholeFixtureEnvelopeCorrelation=whole.best;report.wholeFixtureOffsetMs=whole.offset;
 if(first.best<.85||whole.best<.85)throw Error('Captured audio does not sufficiently match the supplied fixture');report.passed=true;
}catch(error){report.error=String(error.message||error);process.exitCode=1;}
finally{
 try{await capture?.catch(()=>{});await browser?.close();if(remote)await adb(['shell','su','0','rm','-f',remote]);report.cleaned=true;}
 catch(error){report.cleaned=false;report.passed=false;report.cleanupError=String(error);process.exitCode=1;}
 finally{lease.release();if(outputCreated)await fs.writeFile(path.join(options.output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
}
