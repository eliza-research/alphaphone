from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,zipfile
parser=argparse.ArgumentParser(description="Prepare a same-payload, same-debug-signer APK for AOSP presigned import.")
parser.add_argument('--keystore',type=Path,required=True,help='Existing Android development keystore (standard androiddebugkey only)')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
source=root/'artifacts/launcher-debug.apk'; raw=root/'artifacts/launcher-aosp-unaligned.apk'; aligned=root/'artifacts/launcher-aosp-aligned.apk'; output=root/'artifacts/launcher-aosp-debug.apk'
tools=Path(os.environ['ANDROID_HOME'])/'build-tools/36.0.0'
if 'application-debuggable' not in subprocess.check_output([str(tools/'aapt'),'dump','badging',str(source)],text=True):raise RuntimeError('Development APK required')
def signature(name):return bool(re.fullmatch(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))',name,re.I))
def payloads(p):
 with zipfile.ZipFile(p) as z:return {i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist() if not signature(i.filename)}
before=payloads(source)
with zipfile.ZipFile(source) as src,zipfile.ZipFile(raw,'w') as dst:
 for i in src.infolist():
  if signature(i.filename):continue
  data=src.read(i)
  if i.filename.startswith('lib/') and i.filename.endswith('.so'):i.compress_type=zipfile.ZIP_STORED
  dst.writestr(i,data)
subprocess.run([str(tools/'zipalign'),'-P','16','-f','4',str(raw),str(aligned)],check=True)
subprocess.run([str(tools/'apksigner'),'sign','--ks',str(args.keystore),'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',str(output),str(aligned)],check=True)
def cert(p):
 s=subprocess.check_output([str(tools/'apksigner'),'verify','--print-certs',str(p)],text=True)
 return re.search(r'Signer #1 certificate SHA-256 digest: ([a-f0-9]+)',s).group(1)
if cert(source)!=cert(output):raise RuntimeError('APK signing identity changed')
if before!=payloads(output):raise RuntimeError('APK payload changed')
with zipfile.ZipFile(output) as z:
 libs=[i for i in z.infolist() if i.filename.startswith('lib/') and i.filename.endswith('.so')]
 if not libs or not all(i.compress_type==zipfile.ZIP_STORED for i in libs):raise RuntimeError('JNI entries must be stored')
subprocess.run([str(tools/'zipalign'),'-c','-P','16','4',str(output)],check=True)
report={'source':str(source),'output':str(output),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'certificateSha256':cert(output),'payloadEntriesUnchanged':len(before),'manifestUnchanged':True,'uncompressedJniLibraries':len(libs),'jniZipAlignment':16384,'developmentOnly':True}
(root/'artifacts/aosp-apk-preparation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
raw.unlink();aligned.unlink()
