"""Pure metadata admission helpers; never imports repository code."""
import hashlib,json,os,pathlib,re,time
P=pathlib.Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def validate(go):
 assert os.environ['RUNNER_ENVIRONMENT']=='github-hosted'and os.environ['GITHUB_REPOSITORY']=='eliza-research/alphaphone'and os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch'and os.environ['GITHUB_RUN_ATTEMPT']=='1'
 assert go['action']=='ONE_EXACT_QUALIFICATION_RUN'and go['recipe']=='alpha-updater-three-normal-wholefiles'and go['mode']=='qualify'
 assert go['operatorCommit']==os.environ['GITHUB_SHA']==os.environ['EXPECTED_WORKFLOW_SHA']
 assert re.fullmatch('[a-f0-9]{32}',go['intentId'])and 0<go['issuedEpoch']<=time.time()<go['expiresEpoch']<=go['issuedEpoch']+1200
 plan=json.loads((P/'PLAN.json').read_text())
 for k in ['Alpha','AlphaTree','SDK','SDKTree','expectedRegistrations']:assert go[k]==plan[k]
 for k in ['allowExactVendorJDKDownload','allowNormalClientFeatureProducer','allowThreeWholeFiles','allowSDKSourceMaterialization']:assert go[k]is True
 for k in ['allowExternalProviders','allowDeviceOrAndroid','allowSourceOverlay','allowLocalDocker']:assert go[k]is False
 for key,n in [('planSHA256','PLAN.json'),('toolchainSHA256','TOOLCHAIN.json'),('sourceCasesSHA256','SOURCE-CASE-IDENTITIES.json'),('hostCohortsSHA256','HOST-COHORTS.json')]:assert go[key]==sha(P/n)
 assert go['operatorSealSHA256']==sha(P/'SEAL.json')
 for n,digest in json.loads((P/'SEAL.json').read_text())['files'].items():assert sha(P/n)==digest,n
 host=json.loads((P/'HOST-COHORTS.json').read_text());assert os.environ.get('ImageOS')==host['ImageOS']and os.environ.get('ImageVersion')in host['allowedImageVersions']
 assert go['hostProvenanceDisclosure']==json.loads((P/'HOST-DISCLOSURE.json').read_text())
 out=pathlib.Path(go['output']);assert out.is_absolute()and out.is_relative_to(pathlib.Path(os.environ['RUNNER_TEMP']).resolve())
 return plan
