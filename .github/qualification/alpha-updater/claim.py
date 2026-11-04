"""One durable exclusive source-bound intent; metadata only before source setup."""
import json,os,pathlib,time,urllib.request,urllib.parse
sys_path_operator=__import__('sys').path
sys_path_operator.insert(0,str(__import__('pathlib').Path(__file__).resolve().parent))
from validate import validate,sha,P
text=os.environ['ROOT_GO_TEXT'];assert len(text.encode())<=65536;go=json.loads(text);validate(go)
name='alpha-updater-intent-'+go['intentId'];url='https://api.github.com/repos/eliza-research/alphaphone/actions/artifacts?'+urllib.parse.urlencode({'name':name,'per_page':100})
req=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
with urllib.request.urlopen(req,timeout=20)as response:
 raw=response.read(262145);assert len(raw)<=262144;existing=json.loads(raw)
assert existing['total_count']==0 and not existing['artifacts'],'Spent/ambiguous intent; no retry'
temp=pathlib.Path(os.environ['RUNNER_TEMP']).resolve();path=temp/'alpha-updater-root-go.json'
with path.open('x')as f:f.write(text)
claim={'rootGOsha256':sha(path),'actualRunId':os.environ['GITHUB_RUN_ID'],'attempt':1,'claimedEpoch':time.time(),'GO':go,'runner':{k:os.environ.get(k)for k in ['ImageOS','ImageVersion','RUNNER_ENVIRONMENT']}}
with(temp/'alpha-updater-intent-claim.json').open('x')as f:json.dump(claim,f,indent=2)
with pathlib.Path(os.environ['GITHUB_OUTPUT']).open('a')as f:f.write('intent_id='+go['intentId']+'\n')
