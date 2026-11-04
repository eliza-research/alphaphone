"""Finite hosted Alpha updater33 whole-file qualification. Not admitted or run."""
import collections,hashlib,json,os,pathlib,re,selectors,signal,shutil,subprocess,sys,time,urllib.request,xml.etree.ElementTree as ET
sys_path_operator=__import__('sys').path
sys_path_operator.insert(0,str(__import__('pathlib').Path(__file__).resolve().parent))
from validate import validate,P,sha
assert len(sys.argv)==3
source=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
go_path=pathlib.Path(os.environ['ROOT_GO_JSON']).resolve();go=json.loads(go_path.read_text());plan=validate(go);bounds=plan['resourceBounds']
assert sys.platform=='linux'and os.uname().machine=='x86_64'and hasattr(os,'WNOWAIT')
assert source==pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()/'source'and str(out)==go['output']and not out.exists()
claim=json.loads((pathlib.Path(os.environ['RUNNER_TEMP'])/'alpha-updater-intent-claim.json').read_text());assert claim['rootGOsha256']==sha(go_path)and claim['actualRunId']==os.environ['GITHUB_RUN_ID']and claim['attempt']==1 and claim['GO']==go
artifact=os.environ['CLAIM_ARTIFACT_ID'];assert artifact.isdigit()
request=urllib.request.Request('https://api.github.com/repos/eliza-research/alphaphone/actions/artifacts/'+artifact,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
with urllib.request.urlopen(request,timeout=20)as response:
 raw=response.read(262145);assert len(raw)<=262144;actual=json.loads(raw)
assert actual['name']=='alpha-updater-intent-'+go['intentId']and actual['workflow_run']['id']==int(os.environ['GITHUB_RUN_ID'])and not actual['expired']
with go_path.with_suffix('.consumed').open('x')as f:f.write('spent')
out.mkdir();start=time.monotonic();free_start=shutil.disk_usage(out).free;assert free_start>=bounds['entryFreeBytes']
# Inherited finite phase code uses the same sealed resourceBounds names.
plan['resourceBounds'].update(stopFreeBytes=bounds['stopFreeBytes'],maxDiskGrowthBytes=bounds['maxDiskGrowthBytes'])
records=[];owned=[];cleanup_errors=[];process_observations={};last_process_scan=0.0;status='FAILED';run_error=None;image=None;result_detail={}
runid=os.environ['GITHUB_RUN_ID'];assert runid.isdigit();prefix='alpha-updater-'+runid+'-1'
for key in ['DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','DOCKER_API_VERSION','DOCKER_CONTEXT']:assert not os.environ.get(key)
assert os.environ.get('DOCKER_HOST','unix:///var/run/docker.sock')=='unix:///var/run/docker.sock'
os.environ['DOCKER_HOST']='unix:///var/run/docker.sock';docker_config=out.parent/('alpha-updater-docker-'+runid);docker_config.mkdir();os.environ['DOCKER_CONFIG']=str(docker_config)
resource_inspect_format='{"JavaHome":{{$j := ""}}{{range .Config.Env}}{{if eq (printf "%.10s" .) "JAVA_HOME="}}{{$j = .}}{{end}}{{end}}{{json $j}},"JavaOptions":{{$j := ""}}{{range .Config.Env}}{{if eq (printf "%.18s" .) "JAVA_TOOL_OPTIONS="}}{{$j = .}}{{end}}{{end}}{{json $j}},"NetworkMode":{{json .HostConfig.NetworkMode}},"ReadOnlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"CgroupParent":{{json .HostConfig.CgroupParent}},"Ulimits":{{json .HostConfig.Ulimits}},"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"State":{"Status":{{json .State.Status}},"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}},"Error":{{json .State.Error}}},"Resources":{"memoryBytes":{{json .HostConfig.Memory}},"memorySwapBytes":{{json .HostConfig.MemorySwap}},"nanoCpus":{{json .HostConfig.NanoCpus}},"pidsLimit":{{json .HostConfig.PidsLimit}},"nodeOptions":{{$nodeOptions := ""}}{{range .Config.Env}}{{if eq (printf "%.13s" .) "NODE_OPTIONS="}}{{$nodeOptions = .}}{{end}}{{end}}{{json $nodeOptions}}}}'

inspect_format='{"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"State":{"Status":{{json .State.Status}},"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}},"Error":{{json .State.Error}}}}'

class PhaseExitError(RuntimeError):
 def __init__(self,phase_name,code):
  super().__init__(f'{phase_name} exited {code}');self.phase_name=phase_name;self.code=code

def identity(pid):
 try:
  fields=pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
  return {'state':fields[0],'pgid':int(fields[2]),'birth':fields[19]}
 except FileNotFoundError:return None

def group_members(pgid):
 result=[]
 for entry in pathlib.Path('/proc').iterdir():
  if not entry.name.isdigit():continue
  value=identity(int(entry.name))
  if value and value['pgid']==pgid and value['state']!='Z':result.append(int(entry.name))
 return result


def observe_namespace_processes():
 global last_process_scan
 now=time.monotonic()
 if now-last_process_scan<0.05:return
 last_process_scan=now
 targets={x['cid']for x in owned if x.get('cid')and not x.get('closed')}
 for entry in pathlib.Path('/proc').iterdir():
  if not entry.name.isdigit():continue
  try:
   if entry.stat().st_uid!=os.getuid():continue
   cgroup=(entry/'cgroup').read_text();matched=next((cid for cid in targets if cid in cgroup),None)
   if not matched:continue
   raw=(entry/'stat').read_text();close=raw.rfind(')');comm=raw[raw.index('(')+1:close];fields=raw[close+2:].split();birth=fields[19]
   key=entry.name+':'+birth
   if key not in process_observations:
    assert len(process_observations)<4096,'Process observation cap'
    process_observations[key]={'pid':int(entry.name),'birth':birth,'ppid':int(fields[1]),'pgid':int(fields[2]),'comm':comm,'cid':matched,'firstSeenSeconds':now-start}
  except (FileNotFoundError,ProcessLookupError):continue

def verify_observed_process_closure():
 rows=[]
 for item in process_observations.values():
  actual=identity(item['pid']);closed=actual is None or actual['birth']!=item['birth']or actual['state']=='Z'
  assert closed,'Observed original container process still live after CID close'
  rows.append({**item,'originalBirthTerminalOrGone':closed})
 (out/'ACTUAL-NAMESPACE-PROCESSES.json').write_text(json.dumps({'observed':rows,'samplingSeconds':0.05,'scope':'Actual sampled exactownedCID Linuxprocessbirth/parent/PGID metadata; not exhaustive everyshort-livedspawn/thread trace. DockerPIDnamespaceinitexit+exactCIDremove provides wholecontainedforest teardown proof.','allObservedOriginalBirthsClosed':True},indent=2)+'\n')
 return rows

def phase(name,args,timeout,accepted=(0,),cleanup=False):
 begin=time.monotonic();log=out/(name+'.log');written=0;proc=None;birth=None;empty=False;code=None;error=None;sel=None
 def signal_owned(sig):
  current=identity(proc.pid)
  assert current and current['birth']==birth and current['pgid']==proc.pid,'Lost child/PGID custody'
  os.killpg(proc.pid,sig)
 try:
  if not cleanup:
   assert time.time()<go['expiresEpoch'], 'Root GO expired'
   free=shutil.disk_usage(out).free
   if free<plan['resourceBounds']['stopFreeBytes'] or free_start-free>plan['resourceBounds']['maxDiskGrowthBytes']:raise RuntimeError('disk bound before launch')
   if time.monotonic()-start>1200:raise RuntimeError('whole-job wall bound before launch')
  # Reserve the exclusive receipt before starting any child. A duplicate path
  # must fail with proc=None, preserving the original log and spawning nothing.
  with log.open('xb') as stream:
   proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
   first=identity(proc.pid);assert first and first['pgid']==proc.pid;birth=first['birth']
   os.set_blocking(proc.stdout.fileno(),False);sel=selectors.DefaultSelector();sel.register(proc.stdout,selectors.EVENT_READ)
   def drain(wait=0):
    nonlocal written
    for key,_ in sel.select(wait):
     data=os.read(key.fileobj.fileno(),65536)
     if not data:sel.unregister(key.fileobj);continue
     written+=len(data)
     if written>8*1024**2:raise RuntimeError('phase log cap')
     stream.write(data);stream.flush()
   while True:
    drain(.05)
    if name in ['normal-three-files','tool-provenance','normal-pretest-producer']:observe_namespace_processes()
    if time.monotonic()-begin>timeout:raise RuntimeError('phase wall bound')
    if not cleanup:
     assert time.time()<go['expiresEpoch'], 'Root GO expired'
     free=shutil.disk_usage(out).free
     if free<plan['resourceBounds']['stopFreeBytes'] or free_start-free>plan['resourceBounds']['maxDiskGrowthBytes']:raise RuntimeError('disk bound')
     if time.monotonic()-start>1200:raise RuntimeError('whole-job wall bound')
    # WNOWAIT deliberately retains the leader identity until its group is empty.
    if os.waitid(os.P_PID,proc.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT):
     deadline=time.monotonic()+1
     while group_members(proc.pid) and time.monotonic()<deadline:drain(.05)
     if group_members(proc.pid):raise RuntimeError('Descendant outlived leader')
     empty=True
     for _ in range(20):
      drain(.01)
      if not sel.get_map():break
     break
  code=proc.wait(timeout=2)
  if code not in accepted:raise PhaseExitError(name,code)
 except BaseException as exc:error=type(exc).__name__+': '+str(exc);raise
 finally:
  if proc and not empty:
   try:
    if group_members(proc.pid):signal_owned(signal.SIGTERM)
    deadline=time.monotonic()+1
    while group_members(proc.pid) and time.monotonic()<deadline:time.sleep(.05)
    if group_members(proc.pid):signal_owned(signal.SIGKILL)
    deadline=time.monotonic()+2
    while group_members(proc.pid) and time.monotonic()<deadline:time.sleep(.05)
    empty=not group_members(proc.pid)
    if empty:code=proc.wait(timeout=2)
   except BaseException as exc:error=(error or '')+'; cleanup '+str(exc)
  if proc is None:empty=True
  if sel is not None:sel.close()
  records.append({'phase':name,'seconds':time.monotonic()-begin,'exit':code,'acceptedExit':code in accepted,'error':error,'logBytes':written,'leaderBirth':birth,'ownedGroupEmpty':empty})
  if proc and proc.stdout:proc.stdout.close()
  if not empty:raise RuntimeError('Unclosed owned process group')
 return log.read_text(),code

def inspect_container(key,label,cleanup=False,resources=False):
 text,code=phase(label,['docker','container','inspect','--format',resource_inspect_format if resources else inspect_format,key],10,accepted=(0,1),cleanup=cleanup)
 if code==1:
  assert 'No such object' in text or 'No such container' in text,'Container lookup failed ambiguously'
  return None
 return json.loads(text)

def check_container(value,item):
 assert re.fullmatch('[a-f0-9]{64}',value['Id']) and value['Name']=='/'+item['name']
 if item['cid'] is not None:assert value['Id']==item['cid']
 assert value['Labels']['org.eliza.qualification-run']==runid and value['Labels']['org.eliza.qualification-kind']=='speech-retirement'

class ResourcePolicyError(RuntimeError):
 pass

def check_resources(value,item,label):
 if value.get('JavaHome')!='JAVA_HOME=/opt/qualification-jdk'or value.get('JavaOptions')!='JAVA_TOOL_OPTIONS=-Xmx512m -XX:ActiveProcessorCount=2'or value.get('NetworkMode')!='none'or value.get('ReadOnlyRootfs')is not True:
  item.setdefault('resourcePolicyFailures',[]).append({'where':label,'error':'Actual JDK budget/home/network/rootfs differs'});raise ResourcePolicyError('Actual native tool environment/isolation policy mismatch')
 if item.get('cgroupParent')is not None and value.get('CgroupParent')!=item['cgroupParent']:
  item.setdefault('resourcePolicyFailures',[]).append({'where':label,'expectedCgroupParent':item['cgroupParent'],'actualCgroupParent':value.get('CgroupParent')});raise ResourcePolicyError('Actual producer cgroup parent differs from checked hierarchy')
 if item.get('metadataFileSizeLimitBytes')is not None:
  expected=[{'Name':'fsize','Hard':8388608,'Soft':8388608}]
  if value.get('Ulimits')!=expected:
   item.setdefault('resourcePolicyFailures',[]).append({'where':label,'expectedUlimits':expected,'actualUlimits':value.get('Ulimits')});raise ResourcePolicyError('Wrong actual metadata hard file-size limit')
 actual=value.get('Resources')
 if actual!=item['resources']:
  item.setdefault('resourcePolicyFailures',[]).append({'where':label,'expected':item['resources'],'actual':actual})
  raise ResourcePolicyError('Actual Docker resource/Node heap policy mismatch')

def cleanup_container(item,label):
 key=item['cid'] or item['name'];policy_failure=None
 try:
  value=inspect_container(key,label+'-identity',cleanup=True,resources=True)
 except BaseException as exc:
  # A failed resource probe must not prevent custody-only owned cleanup.
  item.setdefault('resourcePolicyFailures',[]).append({'where':label,'resourceInspectionError':type(exc).__name__+': '+str(exc)})
  policy_failure=ResourcePolicyError('Resource inspection failed during owned cleanup')
  value=inspect_container(key,label+'-owner-only-identity',cleanup=True)
 if value:
  check_container(value,item);item['cid']=value['Id']
  if policy_failure is None:
   try:check_resources(value,item,label)
   except ResourcePolicyError as exc:policy_failure=exc
  phase(label+'-remove',['docker','rm','-f',item['cid']],10,cleanup=True)
  assert inspect_container(item['cid'],label+'-absence',cleanup=True) is None
 elif not item['createCompleted']:
  raise RuntimeError('Container creation outcome unknown; no matching container observed')
 item['closed']=True
 if policy_failure:raise policy_failure

def container(name,command,seconds,rw=False):
 assert rw==(name=='normal-pretest-producer')
 cname=prefix+'-'+name;assert inspect_container(cname,name+'-absence')is None
 resources={'memoryBytes':2147483648,'memorySwapBytes':2147483648,'nanoCpus':2000000000,'pidsLimit':256,'nodeOptions':'NODE_OPTIONS=--max-old-space-size=1536'}
 args=['docker','create','--pull=never','--name',cname,'--label','org.eliza.qualification-run='+runid,'--label','org.eliza.qualification-kind=speech-retirement','--network','none','--cpus','2','--memory','2g','--memory-swap','2g','--pids-limit','256','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user',str(os.getuid())+':'+str(os.getgid()),'--tmpfs','/tmp:rw,nosuid,size=536870912','--mount','type=bind,src='+str(source)+',dst=/workspace'+(''if rw else',readonly'),'--mount','type=bind,src='+str(out)+',dst=/results','--workdir','/workspace','--env','HOME=/tmp/home','--env','TMPDIR=/tmp','--env','CI=true','--env','NODE_ENV=test','--env',resources['nodeOptions'],'--env','JAVA_HOME=/opt/qualification-jdk','--env','JAVA_TOOL_OPTIONS=-Xmx512m -XX:ActiveProcessorCount=2','--ulimit','fsize=8388608:8388608','--entrypoint',command[0],image,*command[1:]]
 item={'cid':None,'name':cname,'createCompleted':False,'resources':resources,'metadataFileSizeLimitBytes':8388608};owned.append(item)
 text,_=phase(name+'-create',args,20);cid=text.strip();assert re.fullmatch('[a-f0-9]{64}',cid);item['cid']=cid;item['createCompleted']=True
 value=inspect_container(cid,name+'-identity',resources=True);check_container(value,item);check_resources(value,item,name+'-identity')
 failure=None
 try:phase(name,['docker','start','--attach',cid],seconds)
 except PhaseExitError as error:
  if error.phase_name!=name:raise
  failure=error
 value=inspect_container(cid,name+'-postidentity',resources=True);check_container(value,item);check_resources(value,item,name+'-postidentity');s=value['State']
 assert not s['Running']and s['Status']=='exited'and not s['OOMKilled']and not s['Error']and s['ExitCode']==(failure.code if failure else 0)and s['ExitCode']<128
 # Docker's PID namespace has no live process after its init exits; namespace
 # descendants are killed by the runtime/kernel. Exact owned CID is then removed.
 cleanup_container(item,'after-'+name)
 if failure:raise failure

def source_frame(label):
 phase(label,[sys.executable,'-I','-B',str(P/'source-frame.py'),str(source),str(out/'SOURCE-FRAME.json'),str(P/'PLAN.json')],120)

try:
 for label,path,head in [('alpha',source,plan['Alpha']),('sdk',source/'vendor/eliza',plan['SDK'])]:
  if subprocess.check_output(['git','-C',str(path),'rev-parse','--is-shallow-repository'],timeout=10).strip()==b'true':
   import base64
   credential='AUTHORIZATION: basic '+base64.b64encode(('x-access-token:'+os.environ['GH_TOKEN']).encode()).decode()
   os.environ.update(GIT_CONFIG_COUNT='1',GIT_CONFIG_KEY_0='http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0=credential)
   try:phase('complete-exact-'+label+'-ancestry',['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false','-C',str(path),'fetch','--no-tags','--unshallow','origin',head],300)
   finally:
    for key in ['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0']:os.environ.pop(key,None)
   del credential
 for label,kind,path,head in [('guard-alpha','product',source,plan['Alpha']),('guard-sdk','sdk',source/'vendor/eliza',plan['SDK'])]:
  text,_=phase(label,[sys.executable,'-I','-B',str(P/'check_source.py'),'--kind',kind,'--repo',str(path),'--expected-head',head],90);guard=json.loads(text);assert guard['result']=='PASS'and guard['ancestryComplete']is True
 text,_=phase('docker-platform',['docker','info','--format','{{.OSType}}/{{.Architecture}}'],10);assert text.strip()=='linux/x86_64'
 text,_=phase('docker-version',['docker','version','--format','{{.Server.Version}}'],10);assert text.strip()=='28.0.4'
 text,_=phase('docker-endpoint',['docker','context','inspect','default','--format','{{json .Endpoints.docker.Host}}'],10);assert json.loads(text)=='unix:///var/run/docker.sock'
 source_frame('source-frame-before')
 toolchain=json.loads((P/'TOOLCHAIN.json').read_text());phase('pull-node',['docker','pull','library/node@'+toolchain['nodeImageDigest']],120)
 jdkdir=out.parent/('alpha-updater-jdk-'+runid);phase('vendor-jdk-archive',[sys.executable,'-I','-B',str(P/'prepare-jdk.py'),str(jdkdir)],240)
 (out/'JDK-ARCHIVE-CUSTODY.json').write_bytes((jdkdir/'JDK-ARCHIVE-CUSTODY.json').read_bytes())
 phase('toolchain-build',['docker','build','--network=none','--pull=false','-t',prefix+'-tools','-f',str(P/'Dockerfile'),str(jdkdir)],90)
 text,_=phase('image-identity',['docker','image','inspect',prefix+'-tools','--format','{{.Id}}'],10);image=text.strip();assert re.fullmatch('sha256:[a-f0-9]{64}',image)
 for name in ['TOOLCHAIN.json','raw-events.mjs','tool-provenance.mjs','projection-custody.mjs']:(out/name).write_bytes((P/name).read_bytes())
 container('tool-provenance',['/usr/local/bin/node','/results/tool-provenance.mjs'],60)
 container('projection-before',['/usr/local/bin/node','/results/projection-custody.mjs','before'],30)
 container('normal-pretest-producer',plan['commands']['producer'],120,rw=True);source_frame('source-frame-after-producer')
 container('projection-after',['/usr/local/bin/node','/results/projection-custody.mjs','after'],30)
 testfailure=None
 try:container('normal-three-files',plan['commands']['tests'],600)
 except PhaseExitError as error:testfailure=error
 source_frame('source-frame-after-tests');container('projection-final',['/usr/local/bin/node','/results/projection-custody.mjs','final'],30)
 from report_proof import reconcile_reports
 result_detail=reconcile_reports(out,json.loads((P/'SOURCE-CASE-IDENTITIES.json').read_text()))
 assert testfailure is None
 status='SELECTED33_NORMAL_NODE_HOST_JVM_SCOPE_PASS'
except BaseException as error:run_error=type(error).__name__+': '+str(error)
finally:
 for index,item in enumerate(owned):
  try:cleanup_container(item,'cleanup-'+str(index))
  except BaseException as error:cleanup_errors.append({'cid':item['cid'],'error':str(error)})
 try:observed_processes=verify_observed_process_closure()
 except BaseException as error:
  cleanup_errors.append({'processClosureError':str(error)});observed_processes=[]
 resource_errors=[{'cid':item['cid'],**error}for item in owned for error in item.get('resourcePolicyFailures',[])]
 result={'state':status if not cleanup_errors and not resource_errors else'CLEANUP_OR_RESOURCE_FAILURE','error':run_error,'phases':records,'containers':owned,'cleanupErrors':cleanup_errors,'resourceErrors':resource_errors,'source':{k:plan[k]for k in ['Alpha','AlphaTree','SDK','SDKTree']},'detail':result_detail,'observedNamespaceProcessCount':len(observed_processes),'observedJavaProcesses':sum(x['comm']in['java','javac']for x in observed_processes),'qualificationIssued':status=='SELECTED33_NORMAL_NODE_HOST_JVM_SCOPE_PASS'and not run_error and not cleanup_errors and not resource_errors,'seconds':time.monotonic()-start,'AndroidBinderDeviceProviderHumanAcceptance':False,'noUnchanged12_253_113Replay':True}
 (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n')
raise SystemExit(0 if result['qualificationIssued']else 1)
