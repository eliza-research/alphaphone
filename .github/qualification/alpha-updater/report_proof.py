"""Reconcile pinned Node raw events/JUnit as data; no fixture/runner imports."""
import collections,hashlib,json,math,pathlib,xml.etree.ElementTree as ET

def reconcile_reports(out,cases):
 expected={};by_file={x['path']:x['registrations']for x in cases['files']}
 for group in cases['files']:
  for row in group['tests']:
   key=(group['path'],row['name']);assert key not in expected;expected[key]=row
 assert len(expected)==33
 def file_identity(value,global_ok=False):
  if global_ok and value in (None,''):return None
  assert isinstance(value,str)
  if value in by_file:return value
  if value.startswith('/workspace/')and value[len('/workspace/'):]in by_file:return value[len('/workspace/'):]
  raise AssertionError('Unknown emitted file identity: '+str(value))
 def bounded(name):
  f=out/name;assert f.is_file()and not f.is_symlink()and f.stat().st_size<=8388608;return f
 def sha(f):return hashlib.sha256(f.read_bytes()).hexdigest()
 events=bounded('normal.events.jsonl');observed={kind:collections.Counter()for kind in ['test:enqueue','test:dequeue','test:start','test:complete','test:pass','test:fail']};envelopes=[];summaries=[];plans=[]
 for line in events.read_text().splitlines():
  event=json.loads(line);assert isinstance(event,dict)and isinstance(event.get('type'),str)and isinstance(event.get('data'),dict);kind=event['type'];data=event['data']
  if kind in observed:
   file=file_identity(data.get('file'));name=data.get('name');assert isinstance(name,str);key=(file,name)
   if key not in expected:
    assert name in [file,'/workspace/'+file]and data.get('nesting')==0 and data.get('line')==data.get('column')==1,'Unrecognized runner-file envelope'
    assert kind!='test:fail'and not data.get('skip')and not data.get('todo');envelopes.append({**data,'eventType':kind});continue
   row=expected[key];assert data.get('nesting')==row['nesting']and data.get('line')==row['line']and data.get('column')==row['column'],'Wrong emitted source/nesting coordinates'
   assert not data.get('skip')and not data.get('todo')and not data.get('expectFailure'),'Case directive rejected'
   if kind in ['test:enqueue','test:dequeue']:assert data.get('type')=='test'
   if kind in ['test:pass','test:fail','test:complete']:assert data.get('details',{}).get('type')=='test'
   observed[kind][key]+=1
  elif kind=='test:summary':
   file=file_identity(data.get('file'),True);assert data.get('success')is True;counts=data.get('counts');assert isinstance(counts,dict)
   count=33 if file is None else by_file[file];want={'tests':count,'passed':count,'failed':0,'cancelled':0,'skipped':0,'todo':0,'topLevel':count,'suites':0}
   assert all(type(counts.get(k))is int and counts[k]==v for k,v in want.items()),'Per-file/global summary inconsistent'
   if'nesting'in data:assert data['nesting']==0
   assert isinstance(data.get('duration_ms'),(int,float))and math.isfinite(data['duration_ms'])and data['duration_ms']>=0
   summaries.append({'file':file,'counts':counts,'duration_ms':data['duration_ms']})
  elif kind=='test:plan':
   file=file_identity(data.get('file'),True);count=33 if file is None else by_file[file];assert data.get('nesting')==0 and data.get('count')==count;plans.append({'file':file,'count':count})
  elif kind=='test:interrupted':raise AssertionError('Interrupted test run')
 counter=collections.Counter(expected.keys());assert observed['test:enqueue']==counter,'Missing/duplicate ordinary registrations'
 assert observed['test:pass']==counter and not observed['test:fail'],'Missing/duplicate/nonpassing case completions'
 for kind in ['test:dequeue','test:start','test:complete']:
  if observed[kind]:assert observed[kind]==counter,'Emitted case lifecycle identity mismatch'
 assert collections.Counter(s['file']for s in summaries)==collections.Counter([None,*by_file]),'Missing/duplicate per-file/global summaries'
 assert sum(p['file']is None for p in plans)==1,'Missing global normal test plan'
 # Runner FileTest envelopes are never counted as the33 ordinary test cases.
 for kind in set(x['eventType']for x in envelopes):
  rows=[x for x in envelopes if x['eventType']==kind];assert len(rows)==len({file_identity(x['file'])for x in rows})and len(rows)<=3,'Duplicate runner-file envelopes'
 tap=bounded('normal.tap');junit_file=bounded('normal.junit.xml');tree=ET.parse(junit_file);root=tree.getroot();assert root.tag=='testsuites'
 assert not any(root.iter('failure'))and not any(root.iter('error'))and not any(root.iter('skipped')),'JUnit status elements reject'
 junit_cases=collections.Counter();file_attributes=0
 def numeric_attributes(element,direct_count,leaf_count):
  attributes=element.attrib
  for key in ['failures','errors','skipped','disabled','cancelled','todo']:
   if key in attributes:assert attributes[key].isdigit()and int(attributes[key])==0,'JUnit nonzero/invalid status aggregate'
  if'tests'in attributes:
   assert attributes['tests'].isdigit();expected_count=leaf_count if element.tag=='testsuites'else direct_count;assert int(attributes['tests'])==expected_count,'JUnit count aggregate inconsistent'
  if'status'in attributes:assert attributes['status']in ['passed','success','completed'],'JUnit nonpassing status field'
  if'time'in attributes:assert math.isfinite(float(attributes['time']))and float(attributes['time'])>=0
 def visit(element):
  assert element.tag in ['testsuites','testsuite','testcase'],'Unknown JUnit element'
  if element.tag=='testcase':
   name=element.attrib.get('name');matches=[key for key in expected if key[1]==name];assert len(matches)==1,'JUnit unknown/ambiguous case'
   file=matches[0][0]
   if'file'in element.attrib:
    assert file_identity(element.attrib['file'])==file;nonlocal_file_attribute[0]+=1
   if'line'in element.attrib:assert int(element.attrib['line'])==expected[(file,name)]['line']
   if'column'in element.attrib:assert int(element.attrib['column'])==expected[(file,name)]['column']
   assert not list(element),'Unexpected JUnit testcase payload';numeric_attributes(element,1,1);junit_cases[(file,name)]+=1;return 1
  children=list(element);leaves=sum(visit(child)for child in children);numeric_attributes(element,len(children),leaves);return leaves
 nonlocal_file_attribute=[0];total=visit(root);file_attributes=nonlocal_file_attribute[0]
 assert total==33 and junit_cases==counter,'JUnit case/file multiset mismatch'
 result={'registered':33,'passed':33,'failed':0,'skipped':0,'todo':0,'enqueueAndPassIdentitiesMatch':True,'sourceCoordinatesAndNestingMatch':True,'perFileAndGlobalSummaries':summaries,'normalPlans':plans,'runnerFileEnvelopes':envelopes,'runnerFileEnvelopeCountedAsCases':False,'JUnitCaseIdentityAndEmittedFileFieldsChecked':True,'JUnitEmittedFileFieldCount':file_attributes,'JUnitAggregateStatusAndCountFieldsWhereEmittedChecked':True,'JUnitSHA256':sha(junit_file),'rawEventsSHA256':sha(events),'TAPSHA256':sha(tap),'TAPProofScope':'RETAINED_BOUNDED_HASH_ONLY_NOT_INDEPENDENTLY_VALIDATED','scope':'33completeordinaryNodecases; JVMscenario/internalassertcounts separate; no Android/Binder/device/provider proof'}
 (out/'ORDINARY-REPORT-PROOF.json').write_text(json.dumps(result,indent=2)+'\n');return result
