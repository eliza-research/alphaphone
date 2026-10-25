"""Regression checks for the hash-pinned standalone AVB verification candidate."""
import argparse,pathlib,importlib.util,tempfile,subprocess,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidate',type=pathlib.Path,required=True)
parser.add_argument('--aosp-root',type=pathlib.Path,required=True)
args=parser.parse_args()
candidate=args.candidate.resolve()
contract=json.loads((root/'android/aosp/host-tools/avbtool-mldsa.json').read_text())
if hashlib.sha256(candidate.read_bytes()).hexdigest()!=contract['resultSha256']:
 raise ValueError('Candidate differs from the pinned host-tool patch result')
spec=importlib.util.spec_from_file_location('candidate_avb',candidate);avb=importlib.util.module_from_spec(spec);spec.loader.exec_module(avb)
results=[]
with tempfile.TemporaryDirectory(prefix='alpha-avb-fixtures-') as directory:
 d=pathlib.Path(directory);message=b'Alpha AVB regression fixture, not release signing'
 for algorithm,openssl_name in [('MLDSA65','ML-DSA-65'),('MLDSA87','ML-DSA-87')]:
  private=d/(algorithm+'.pem');public=d/(algorithm+'.pub.pem')
  subprocess.run(['openssl','genpkey','-algorithm',openssl_name,'-out',str(private)],check=True,capture_output=True)
  subprocess.run(['openssl','pkey','-in',str(private),'-pubout','-out',str(public)],check=True,capture_output=True)
  loaded=avb.MLDSAPublicKey.load(str(public));signer=avb.MLDSAPublicKey(str(private),loaded.pub);signature=signer.sign(algorithm,message)
  with avb.MLDSAPublicKey.decode(algorithm,loaded.encode()) as decoded:
   assert decoded.verify(algorithm,signature,message)
   bad=bytearray(signature);bad[0]^=1
   assert not decoded.verify(algorithm,bytes(bad),message)
   assert not decoded.verify(algorithm,signature,message+b'changed')
   decoded.pub=decoded.pub[:-1]
   try:decoded.verify(algorithm,signature,message)
   except avb.AvbError:pass
   else:raise AssertionError('Malformed key size accepted')
  results.append({'algorithm':algorithm,'validSignature':True,'corruptSignatureRejected':True,'changedMessageRejected':True,'badKeySizeRejected':True})
 output=d/'rsa-vbmeta.img';key=args.aosp_root.resolve()/'external/avb/test/data/testkey_rsa2048.pem'
 subprocess.run(['python3','-B',str(candidate),'make_vbmeta_image','--output',str(output),'--algorithm','SHA256_RSA2048','--key',str(key)],check=True,capture_output=True)
 data=output.read_bytes();header=avb.AvbVBMetaHeader(data[:256]);assert avb.verify_vbmeta_signature(header,data);bad=bytearray(data);bad[256+header.signature_offset]^=1;assert not avb.verify_vbmeta_signature(header,bytes(bad));results.append({'algorithm':'SHA256_RSA2048','validSignature':True,'corruptSignatureRejected':True})
report={'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'ephemeralTestKeysRetained':False,'results':results,'scope':'Candidate host verifier regression tests, not production signing or device boot.'}
print(json.dumps(report,indent=2))
