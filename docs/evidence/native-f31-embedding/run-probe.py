import pathlib,subprocess,json,hashlib,time,os
out=pathlib.Path(__file__).resolve().parent
adb='/home/shaw/Android/Sdk/platform-tools/adb'
remote='/data/local/tmp/eliza-alpha-jni-f31-20261030-1023'
def run(args,timeout=120):
 return subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
def shell(command):
 p=run([adb,'shell',command]); assert p.returncode==0,p.stdout;return p.stdout.strip()
assert shell('getprop ro.product.cpu.abi')=='arm64-v8a'
assert shell('test ! -e '+remote+'; echo $?')=='0','Owned probe directory already exists'
shell('mkdir -p '+remote+'/bundle/text')
files=[(out/'probe.zip','probe.zip'),(pathlib.Path('/home/shaw/Work/eliza-unification/alpha-jni-f31/jni-build/arm64-v8a/libelizavoicejni.so'),'libelizavoicejni.so'),(pathlib.Path('/home/shaw/Work/eliza-unification/native-build-inputs/abi20/core/arm64-v8a/libelizainference.so'),'libelizainference.so'),(pathlib.Path('/home/shaw/Work/eliza-unification/native-build-inputs/abi20/core/arm64-v8a/libc++_shared.so'),'libc++_shared.so'),(pathlib.Path('/home/shaw/Work/eliza-unification/native-route-policy/packages/app/platforms/android/app/src/main/assets/agent/models/bge-small-en-v1.5-f16.gguf'),'bundle/text/bge-small-en-v1.5-f16.gguf')]
record={'sourcePin':'f31d7c3f860e3dfa1bd118c66df7cacdd60fe3e5','forkPin':'d960f633ddb034d0dd828a55216cfc17d012acbd','remoteDirectory':remote,'startedAt':time.time(),'android':{'abi':shell('getprop ro.product.cpu.abi'),'sdk':shell('getprop ro.build.version.sdk')},'inputs':[],'scope':'Standalone app_process execution of exact generated Alpha Java loader and 81-method full RegisterNatives class with existing ABI20 engine and fixed BGE text. No installed-app, microphone, speaker, network, voice, AOSP, or user acceptance claim.'}
try:
 for source,name in files:
  sha=hashlib.sha256(source.read_bytes()).hexdigest()
  p=run([adb,'push',str(source),remote+'/'+name]);assert p.returncode==0,p.stdout
  device_sha=shell('sha256sum '+remote+'/'+name).split()[0];assert device_sha==sha
  record['inputs'].append({'path':str(source),'devicePath':remote+'/'+name,'bytes':source.stat().st_size,'sha256':sha,'deviceSha256':device_sha})
 command='ulimit -c 0; export ELIZA_LLM_USE_GPU=0 ELIZA_ASR_THREADS=2 GGML_N_THREADS=2 LD_LIBRARY_PATH='+remote+' CLASSPATH='+remote+'/probe.zip; exec app_process -Djava.library.path='+remote+' /system/bin ai.elizaresearch.alphaphone.AlphaJniQualification '+remote+'/bundle'
 record['command']=command
 p=run([adb,'shell',command],timeout=180)
 (out/'device.log').write_text(p.stdout)
 record['exitCode']=p.returncode
 lines=[line[len('ALPHA_JNI_RESULT='):] for line in p.stdout.splitlines() if line.startswith('ALPHA_JNI_RESULT=')]
 if lines:record['result']=json.loads(lines[-1])
 record['status']='passed' if p.returncode==0 and record.get('result',{}).get('status')=='passed' else 'failed'
except Exception as e:
 record['status']='failed';record['error']=str(e)
finally:
 record['finishedAt']=time.time()
 (out/'device-record.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k not in ['inputs','command']},indent=2))
if record['status']!='passed':raise SystemExit(1)
