"""Owned-CID read-only evidence and at most two source-bound JDK attach attempts.
No module-level effects. Construct only in a separately admitted hosted diagnostic.
"""
import hashlib,json,os,pathlib,re,selectors,signal,subprocess,time

class OwnedFlowDiagnostic:
 def __init__(self,out,item,owner_proof,identity,group_members):
  self.out=out;self.item=item;self.owner_proof=owner_proof;self.identity=identity;self.group_members=group_members
  self.cid=item['cid'];self.uid=os.getuid();self.next_tick=0.;self.target=None;self.initial_namespace=None;self.initial_host_pid=None;self.initial_birth=None;self.cgroup=None;self.baseline=None
  self.metadata_bytes=0;self.output_bytes=0;self.command_seconds=0.;self.attempts=[];self.processes={};self.disabled=False;self.last_end=None;self.observer_groups=[]
  assert self.uid>0 and re.fullmatch('[a-f0-9]{64}',self.cid)
  tools=json.loads((out/'TOOL-PROVENANCE.json').read_text());self.jcmd_sha=tools['files']['bin/jcmd']['sha256'];assert re.fullmatch('[a-f0-9]{64}',self.jcmd_sha)
  self.path=out/'FLOW-READONLY-OBSERVATIONS.jsonl';self.path.touch(exist_ok=False)
  self.emit('observer-created',{'cid':self.cid,'noAttachOrExecYet':True,'baselineRequiredBeforeActiveObserver':True})

 def emit(self,kind,data):
  raw=(json.dumps({'kind':kind,'monotonic':time.monotonic(),'data':data},separators=(',',':'))+'\n').encode()
  if self.metadata_bytes+len(raw)>523264:
   self.disabled=True
   if self.metadata_bytes<523264:
    raw=b'{"kind":"observation-cap","data":{"maxBytes":524288,"furtherAttachDisabled":true}}\n'
   else:return
  with self.path.open('ab')as stream:stream.write(raw)
  self.metadata_bytes+=len(raw)

 def read(self,path,cap=16384):
  with pathlib.Path(path).open('rb')as stream:raw=stream.read(cap+1)
  assert len(raw)<=cap,'Metadata read bound';return raw

 def process(self,pid):
  root=pathlib.Path('/proc')/str(pid);in_owned_cgroup=False
  try:
   if root.stat().st_uid!=self.uid:return None
   first=self.read(root/'stat');end=first.rfind(b')');fields=first[end+2:].split();birth=fields[19].decode()
   group=self.read(root/'cgroup').decode();lines=group.splitlines();assert len(lines)==1 and lines[0].startswith('0::/')
   relative=lines[0][3:];assert'..'not in pathlib.PurePosixPath(relative).parts
   if not any(part in [self.cid,'docker-'+self.cid+'.scope']for part in pathlib.PurePosixPath(relative).parts):return None
   in_owned_cgroup=True
   status={line.split(':',1)[0]:line.split(':',1)[1].strip()for line in self.read(root/'status').decode().splitlines()if':'in line}
   uid=[int(x)for x in status['Uid'].split()]
   if uid!=[self.uid]*4:return None
   nsids=[int(x)for x in status['NSpid'].split()]
   if len(nsids)<2 or nsids[0]!=pid:return None
   namespace=os.readlink(root/'ns/pid');assert re.fullmatch(r'pid:\[[0-9]+\]',namespace)
   cmdraw=self.read(root/'cmdline',8192)
   if cmdraw:assert cmdraw.endswith(b'\0')
   argv=[]if not cmdraw else[x.decode('utf8',errors='replace')for x in cmdraw[:-1].split(b'\0')]
   second=self.read(root/'stat');assert second[second.rfind(b')')+2:].split()[19].decode()==birth,'PID birth raced'
   return {'pid':pid,'birth':birth,'ppid':int(fields[1]),'pgid':int(fields[2]),'state':fields[0].decode(),'comm':first[first.index(b'(')+1:end].decode(errors='replace'),'uid':self.uid,'namespacePIDs':nsids,'namespacePID':nsids[-1],'PIDNamespace':namespace,'argv':argv,'javaMainClassFromExactArgv':argv[3]if len(argv)==4 and argv[0]=='/opt/qualification-jdk/bin/java'and argv[1]=='-cp'else None,'threads':int(status['Threads']),'cgroup':relative}
  except (FileNotFoundError,ProcessLookupError):return None
  except PermissionError:
   if in_owned_cgroup and ((self.target and pid==self.target['pid'])or pid==self.initial_host_pid):raise
   # Unproven transient runc/exec entries are not attach targets. Never infer
   # their namespace or identity; retry future pure-read samples instead.
   return None

 def scan(self):
  answer=[];entries=list(pathlib.Path('/proc').iterdir());assert len(entries)<=8192,'Process scan bound'
  for path in entries:
   if path.name.isdigit():
    process=self.process(int(path.name))
    if process:answer.append(process)
  return answer

 def counters(self):
  assert self.cgroup is not None
  root=pathlib.Path('/sys/fs/cgroup')/self.cgroup.lstrip('/');assert root.resolve()==root and self.cid in str(root)
  result={}
  for name in ['pids.current','pids.max','pids.events','memory.events']:
   text=self.read(root/name,4096).decode().strip()
   if name in ['pids.events','memory.events']:result[name]={k:int(v)for k,v in (line.split()for line in text.splitlines())}
   else:result[name]=text if text=='max'else int(text)
  assert result['pids.max']==256,'Actual owned cgroup PID cap differs'
  return result

 def is_flow(self,row):
  a=row['argv'];return row['namespacePID']>1 and len(a)==4 and a[0]=='/opt/qualification-jdk/bin/java'and a[1]=='-cp'and re.fullmatch(r'/tmp/alpha-jvm-[A-Za-z0-9_-]+',a[2])and a[3]=='ai.elizaresearch.alphaphone.UpdateFlowTest'

 def bind_and_snapshot(self,rows):
  if self.initial_namespace is None:
   init=[x for x in rows if x['namespacePID']==1 and x['argv']and x['argv'][0]=='/usr/local/bin/node']
   if not init:self.emit('readonly-waiting-for-actual-init',{'noActiveObserverCommand':True});return None
   assert len(init)==1,'Ambiguous test namespace init'
   self.initial_namespace=init[0]['PIDNamespace'];self.initial_host_pid=init[0]['pid'];self.initial_birth=init[0]['birth'];self.cgroup=init[0]['cgroup']
   # Pure host /proc+/sysfs reads precede every docker-inspect/exec/jcmd
   # diagnostic command. No process is inserted into app cgroup first.
   self.baseline=self.counters();self.emit('PRE-ACTIVE-OBSERVER-COUNTER-BASELINE',{'cgroup':self.cgroup,'counters':self.baseline,'init':init[0],'activeObserverCommands':0})
  owned=[x for x in rows if x['PIDNamespace']==self.initial_namespace and x['cgroup']==self.cgroup]
  for row in owned:
   key=str(row['pid'])+':'+row['birth']
   if key not in self.processes:
    assert len(self.processes)<256,'Diagnostic distinct process bound';self.processes[key]=row;self.emit('actual-process-first-seen',row)
  flow=[x for x in owned if self.is_flow(x)]
  assert len(flow)<=1,'Ambiguous Flow JVM'
  if flow and self.target is None:self.target=flow[0];self.emit('exact-flow-target-bound',self.target)
  target=None if self.target is None else next((x for x in owned if x['pid']==self.target['pid']and x['birth']==self.target['birth']and self.is_flow(x)),None)
  self.emit('readonly-counter-sample',{'counters':self.counters(),'ownedNamespaceProcessCount':len(owned),'flow':None if target is None else{k:target[k]for k in ['pid','birth','namespacePID','threads','state']},'attachAttemptsAlreadyStarted':len(self.attempts)})
  return target

 def verify_target(self):
  assert self.target is not None and self.baseline is not None
  now=self.process(self.target['pid']);assert now and now['birth']==self.target['birth']and now['PIDNamespace']==self.initial_namespace and now['cgroup']==self.cgroup and self.is_flow(now),'Flow identity/UID/mainclass changed'
  state=self.owner_proof('diagnostic-owner-proof-'+str(len(self.attempts)+1));assert state['State']['Running']and state['HostInitPID']==self.initial_host_pid,'Owned CID/init no longer live'
  init=self.process(self.initial_host_pid);assert init and init['birth']==self.initial_birth and init['namespacePID']==1 and init['PIDNamespace']==self.initial_namespace and init['cgroup']==self.cgroup
  again=self.process(now['pid']);assert again and again['birth']==now['birth']and self.is_flow(again)
  binary=pathlib.Path('/proc')/str(self.initial_host_pid)/'root/opt/qualification-jdk/bin/jcmd'
  h=hashlib.sha256()
  with binary.open('rb')as stream:
   while chunk:=stream.read(65536):h.update(chunk)
  assert h.hexdigest()==self.jcmd_sha,'Not the same verified JDK jcmd binary'
  return again

 def observers(self,namespace_pid):
  expected=['/opt/qualification-jdk/bin/jcmd',str(namespace_pid),'Thread.print','-l'];answer=[]
  for row in self.scan():
   if row['PIDNamespace']==self.initial_namespace and row['cgroup']==self.cgroup and row['argv']==expected:
    assert self.target is not None and row['pid']!=self.target['pid'];answer.append(row)
  return answer

 def stop_observers(self,known,namespace_pid,absolute_deadline):
  # Signal ONLY exact observer jcmd births, never Flow, a broad ps result,
  # wildcard PID, or a direct application SIGQUIT/termination fallback.
  for sig in [signal.SIGTERM,signal.SIGKILL]:
   for old in known.values():
    current=self.process(old['pid'])
    if current and current['birth']==old['birth']:
     assert current['PIDNamespace']==self.initial_namespace and current['cgroup']==self.cgroup and current['argv']==['/opt/qualification-jdk/bin/jcmd',str(namespace_pid),'Thread.print','-l']and current['pid']!=self.target['pid']
     os.kill(current['pid'],sig)
   deadline=min(time.monotonic()+0.4,absolute_deadline)
   while time.monotonic()<deadline:
    remaining=self.observers(namespace_pid)
    if not remaining:return True
    for row in remaining:known[str(row['pid'])+':'+row['birth']]=row
    time.sleep(.02)
  return not self.observers(namespace_pid)


 def attach(self):
  assert len(self.attempts)<2 and not self.disabled
  target=self.verify_target();assert not self.observers(target['namespacePID']),'Preexisting matching jcmd is not ours';pre=self.counters();index=len(self.attempts)+1
  attempt={'attempt':index,'preObserverCounters':pre,'originalBaseline':self.baseline,'verifiedTarget':target,'jcmdBinarySHA256':self.jcmd_sha,'effectWarning':'jcmd process/threads/attachlistener may itself hit or increment PID limits; post-observer deltas alone are not application failure proof.','errors':[]};self.attempts.append(attempt)
  self.emit('PRE-JCMD-COUNTERS-AND-TARGET',attempt)
  command=['docker','exec','--user',str(self.uid)+':'+str(os.getgid()),self.cid,'/opt/qualification-jdk/bin/jcmd',str(target['namespacePID']),'Thread.print','-l']
  path=self.out/('FLOW-STACK-'+str(index)+'.log');proc=None;leader=None;sel=None;known={};written=0;overflow=False;timed_out=False;target_changed=False;code=None;closed=None;observer_closed=None;started=time.monotonic()
  remaining=10.-self.command_seconds;cleanup_reserve=2.5;minimum_active=.25
  if remaining<cleanup_reserve+minimum_active:
   attempt['notLaunched']='Shared active+teardown budget cannot fit required reserve';return
  absolute_deadline=started+remaining
  active_deadline=min(started+6.5,absolute_deadline-cleanup_reserve)
  attempt.update({'sharedAbsoluteDeadline':absolute_deadline,'activeDeadline':active_deadline,'plannedCleanupReserveSeconds':cleanup_reserve,'approvedTotalActiveAndTeardownSeconds':10})
  minimum_observer_birth=int(float(self.read('/proc/uptime',256).split()[0])*os.sysconf('SC_CLK_TCK'))-1;attempt['minimumNewObserverBirthTick']=minimum_observer_birth
  # Register every launch intent before Popen. PID is retained immediately on
  # return, before any fallible identity/selector/observer operation. An absent
  # initial birth remains unresolved; it is NEVER invented later for signalling.
  launch={'attempt':index,'argv':command,'spawnAttempted':False,'PopenReturned':False,'pid':None,'birth':None,'pgid':None,'ownershipEstablished':False,'ownedGroupEmpty':None,'selectorClosed':None,'stdoutClosed':None,'reaped':False,'exit':None,'cleanupErrors':[]}
  self.observer_groups.append(launch);attempt['observerLaunchIntent']=launch
  def error(stage,problem,cleanup=False):
   row={'stage':stage,'type':type(problem).__name__,'message':str(problem)[:1024]}
   attempt['errors'].append(row)
   if cleanup:launch['cleanupErrors'].append(row)
   self.disabled=True
  try:
   with path.open('xb')as output:
    if absolute_deadline-time.monotonic()<cleanup_reserve+minimum_active:
     attempt['notLaunched']='Preparation used remaining active allowance';return
    launch['spawnAttempted']=True
    proc=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True,env={'PATH':'/usr/bin:/usr/local/bin:/bin','LANG':'C','LC_ALL':'C','DOCKER_HOST':os.environ['DOCKER_HOST'],'DOCKER_CONFIG':os.environ['DOCKER_CONFIG']})
    launch['PopenReturned']=True;launch['pid']=proc.pid
    leader=self.identity(proc.pid)
    if leader is not None:launch.update({'birth':leader['birth'],'pgid':leader['pgid']})
    assert leader is not None and leader['pgid']==proc.pid,'Original CLI birth/PGID could not be established'
    launch['ownershipEstablished']=True
    sel=selectors.DefaultSelector();os.set_blocking(proc.stdout.fileno(),False);sel.register(proc.stdout,selectors.EVENT_READ)
    while True:
     live_target=self.process(target['pid'])
     if not live_target or live_target['birth']!=target['birth']or live_target['PIDNamespace']!=self.initial_namespace or not self.is_flow(live_target):target_changed=True;break
     for row in self.observers(target['namespacePID']):
      assert int(row['birth'])>=minimum_observer_birth,'Observer birth predates our command';known[str(row['pid'])+':'+row['birth']]=row
     for key,_ in sel.select(.02):
      chunk=os.read(key.fileobj.fileno(),65536)
      if not chunk:sel.unregister(key.fileobj);continue
      capacity=2097152-self.output_bytes
      if len(chunk)>capacity:
       output.write(chunk[:capacity]);written+=capacity;self.output_bytes+=capacity;overflow=True;break
      output.write(chunk);written+=len(chunk);self.output_bytes+=len(chunk)
     if overflow:break
     if time.monotonic()>=active_deadline:timed_out=True;break
     if os.waitid(os.P_PID,proc.pid,os.WEXITED|os.WNOHANG|os.WNOWAIT):
      if not sel.get_map():break
  except BaseException as problem:
   error('attach-body',problem);raise
  finally:
   # Every stage has independent error retention. A scan/kill/custody failure
   # must not skip host CLI cleanup, registration, streams or accounting.
   try:
    if proc is not None:
     try:observer_closed=self.stop_observers(known,target['namespacePID'],absolute_deadline)
     except BaseException as problem:error('observer-jcmd-cleanup',problem,True)
     finally:attempt['observerJcmdBirths']=list(known.values());attempt['observerJcmdClosed']=observer_closed
     # Never signal a group whose original birth was not established. Every
     # already-authorised TERM/KILL stage is independently attempted; no wait
     # is intentionally scheduled past the aggregate absolute deadline.
     for sig in [signal.SIGTERM,signal.SIGKILL]:
      try:
       if launch['ownershipEstablished']is not True:raise RuntimeError('Unresolved original CLI ownership; no signal authorised')
       actual=self.identity(proc.pid)
       if actual is None:
        if not self.group_members(proc.pid):closed=True;break
        raise RuntimeError('Original leader absent but group remains; no unproved signal')
       assert actual['birth']==launch['birth']and actual['pgid']==proc.pid,'Original CLI identity changed; no signal authorised'
       try:members=self.group_members(proc.pid)
       except BaseException as problem:error('host-cli-members-before-'+signal.Signals(sig).name,problem,True);members=None
       if members==[]:closed=True;break
       # A full /proc enumeration error does not erase a separately proven
       # direct-child leader birth/PGID; retain it and perform authorised cleanup.
       os.killpg(proc.pid,sig)
       wait_until=min(time.monotonic()+.3,absolute_deadline)
       while self.group_members(proc.pid)and time.monotonic()<wait_until:time.sleep(.02)
      except BaseException as problem:error('host-cli-'+signal.Signals(sig).name,problem,True)
     try:
      if launch['ownershipEstablished']is not True:raise RuntimeError('CLI original birth/PGID unresolved')
      closed=not self.group_members(proc.pid);launch['ownedGroupEmpty']=closed
     except BaseException as problem:error('host-cli-group-closure-check',problem,True)
     try:
      if closed is True:
       code=proc.wait(timeout=min(.3,max(0.,absolute_deadline-time.monotonic())));launch['reaped']=True;launch['exit']=code
     except BaseException as problem:error('host-cli-reap',problem,True)
    elif launch['spawnAttempted']is True:
     error('spawn-outcome-unresolved',RuntimeError('Popen did not return a handle; no PID/birth invented'),True)
    else:launch['ownedGroupEmpty']=True
   finally:
    try:
     if sel is not None:sel.close()
     launch['selectorClosed']=True
    except BaseException as problem:launch['selectorClosed']=False;error('selector-close',problem,True)
    finally:
     try:
      if proc is not None and proc.stdout:proc.stdout.close()
      launch['stdoutClosed']=True
     except BaseException as problem:launch['stdoutClosed']=False;error('stdout-close',problem,True)
     finally:
      # Pure in-memory accounting cannot be bypassed by fallible post-counter,
      # hash or emitter reads. The attempt object is already in self.attempts.
      elapsed=time.monotonic()-started;self.command_seconds+=elapsed;self.last_end=time.monotonic()
      attempt.update({'argv':command,'exit':code,'timeout':timed_out,'targetChangedDuringAttempt':target_changed,'outputAttributedOnlyWhileExactTargetHeld':not target_changed,'overflow':overflow,'retainedBytes':written,'combinedRetainedBytes':self.output_bytes,'activeCommandAndTeardownSeconds':elapsed,'combinedActiveSeconds':self.command_seconds,'outputPath':path.name,'hostCLIGroupClosed':launch['ownedGroupEmpty'],'completeEveryShortLivedObserverBirthTrace':False,'sampledObserverJcmdBirthCount':len(known),'observerJcmdBirths':list(known.values()),'interferenceAttribution':'Before/after counters are separate; post-observer increments alone are not application PID-failure proof.'})
      if self.command_seconds>10.:
       self.disabled=True;attempt['unavoidableKernelOrMetadataBudgetOverrun']=True
      if observer_closed is not True and proc is not None:self.disabled=True
      if launch['ownedGroupEmpty']is not True:self.disabled=True
      try:attempt['postObserverCounters']=self.counters()
      except BaseException as problem:error('post-observer-counters',problem)
      try:
       if path.exists():assert path.stat().st_size<=2097152;attempt['outputSHA256']=hashlib.sha256(path.read_bytes()).hexdigest()
      except BaseException as problem:error('output-hash',problem)
      try:self.emit('JCMD-ATTEMPT-RESULT',attempt)
      except BaseException as problem:error('attempt-receipt-emission',problem)
 def tick(self):
  if self.disabled:return
  now=time.monotonic()
  if now<self.next_tick:return
  self.next_tick=now+2.
  try:
   target=self.bind_and_snapshot(self.scan())
   if not target:return
   age=float(self.read('/proc/uptime',256).split()[0])-int(target['birth'])/os.sysconf('SC_CLK_TCK')
   if age<60. or age>110. or len(self.attempts)>=2 or self.output_bytes>=2097152:return
   if self.last_end is not None and now-self.last_end<5.:return
   self.attach()
  except (FileNotFoundError,ProcessLookupError):self.emit('target-or-cgroup-ended',{'noAttach':True})
  except Exception as error:
   self.disabled=True;self.emit('diagnostic-applicability-or-custody-gap',{'type':type(error).__name__,'message':str(error)[:1024],'noFurtherAttach':True})

 def finish(self):
  final_groups=[];final_births=[];closure_errors=[]
  # Reconcile EVERY launch intent, including Popen/identity/setup failures.
  for row in self.observer_groups:
   checked={**row,'finalOwnedGroupEmpty':False}
   try:
    if row['spawnAttempted']is False:checked['finalOwnedGroupEmpty']=True
    elif row['PopenReturned']is not True or row['pid']is None or row['birth']is None or row['ownershipEstablished']is not True:
     raise RuntimeError('Launched or ambiguous observer original PID/birth/PGID unresolved')
    elif row['ownedGroupEmpty']is True:checked['finalOwnedGroupEmpty']=True
    else:checked['finalOwnedGroupEmpty']=not self.group_members(row['pid'])
    if checked['finalOwnedGroupEmpty']is not True:raise RuntimeError('Observer original host group remains unclosed')
    if row['spawnAttempted']and(row['reaped']is not True or row['selectorClosed']is not True or row['stdoutClosed']is not True or row['cleanupErrors']):raise RuntimeError('Observer transport/reap or cleanup proof remains incomplete; retained errors preserved')
   except BaseException as problem:
    checked['finalClosureError']={'type':type(problem).__name__,'message':str(problem)[:1024]};closure_errors.append(checked['finalClosureError'])
   final_groups.append(checked)
  observed={str(row['pid'])+':'+row['birth']:row for row in self.processes.values()}
  for attempt in self.attempts:
   for row in attempt.get('observerJcmdBirths',[]):observed[str(row['pid'])+':'+row['birth']]=row
  for row in observed.values():
   item={'pid':row['pid'],'birth':row['birth'],'originalBirthClosed':False}
   try:
    now=self.identity(row['pid']);item['originalBirthClosed']=now is None or now['birth']!=row['birth']or now['state']=='Z'
    if item['originalBirthClosed']is not True:raise RuntimeError('Diagnostic sampled original process still live after original CID cleanup')
   except BaseException as problem:
    item['closureError']={'type':type(problem).__name__,'message':str(problem)[:1024]};closure_errors.append(item['closureError'])
   final_births.append(item)
  data={'diagnosticOnly':True,'qualificationIssued':False,'closureComplete':not closure_errors and all(row['finalOwnedGroupEmpty']is True for row in final_groups),'closureErrors':closure_errors,'ownedCID':self.cid,'initialCounterBaseline':self.baseline,'target':self.target,'attempts':self.attempts,'observerCommandActiveSeconds':self.command_seconds,'combinedOutputBytes':self.output_bytes,'readonlyMetadataBytes':self.metadata_bytes,'observerGroups':self.observer_groups,'finalObserverCLIGroupClosure':final_groups,'finalDiagnosticOriginalBirthClosure':final_births,'disabledOrGap':self.disabled,'sampledProcesses':list(self.processes.values()),'completeEveryShortLivedObserverBirthTrace':False,'scope':'Every launch intent retained and reconciled, unresolved ownership fails closure. No per-case qualification or causal PID-failure conclusion; before-observer counters and observer effects remain separate.'}
  text=json.dumps(data,indent=2)+'\n';assert len(text.encode())<=262144;(self.out/'FLOW-DIAGNOSTIC.json').write_text(text)
  return data
