import hashlib,json,os,pathlib,stat,subprocess,sys
root=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);plan=json.loads(pathlib.Path(sys.argv[3]).read_text());records=[];total=0;metadata_directories=set()
for prefix,head,tree in [('',plan['Alpha'],plan['AlphaTree']),('vendor/eliza',plan['SDK'],plan['SDKTree'])]:
 directory=root/prefix
 metadata=directory/'.git'
 assert metadata.is_dir()and not metadata.is_symlink(),'Only exact checkout metadata directories admitted'
 gitdir=subprocess.check_output(['git','-C',str(directory),'rev-parse','--absolute-git-dir'],timeout=10).decode().strip()
 assert pathlib.Path(gitdir)==metadata and metadata.resolve()==metadata,'External/linked checkout metadata'
 metadata_directories.add(str(metadata.relative_to(root)))
 def git(*args):return subprocess.check_output(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',str(directory),*args],timeout=45,env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_NO_REPLACE_OBJECTS='1',GIT_OPTIONAL_LOCKS='0'))
 assert git('rev-parse','HEAD').decode().strip()==head and git('rev-parse','HEAD^{tree}').decode().strip()==tree
 assert not git('diff','--no-ext-diff','--name-only','HEAD')and not git('ls-files','--others','--exclude-standard')
 assert not any(x.startswith('S ')or x[:1].islower()for x in git('ls-files','-v').decode().splitlines())
 for item in git('ls-tree','-r','-z','HEAD').split(b'\0'):
  if not item:continue
  header,name=item.split(b'\t');mode,kind,oid=header.decode().split();name=name.decode();f=directory/name
  if kind=='commit':
   if prefix=='':assert name=='vendor/eliza'and oid==plan['SDK']
   records.append({'path':str(pathlib.PurePosixPath(prefix)/name),'mode':mode,'kind':'gitlink','OID':oid});continue
  s=f.lstat();assert len(records)<100000
  parent=f.parent
  while parent!=directory:
   assert not parent.is_symlink(),'Linked source parent';parent=parent.parent
  if mode=='120000':assert stat.S_ISLNK(s.st_mode);raw=os.readlink(f).encode();size=len(raw);h=hashlib.sha256(raw).hexdigest();gitblob=hashlib.sha1(b'blob '+str(size).encode()+b'\0'+raw).hexdigest()
  else:
   assert mode in ['100644','100755']and stat.S_ISREG(s.st_mode)and bool(s.st_mode&0o111)==(mode=='100755');size=s.st_size;hobj=hashlib.sha256();gobj=hashlib.sha1(b'blob '+str(size).encode()+b'\0')
   with f.open('rb')as stream:
    while chunk:=stream.read(1048576):hobj.update(chunk);gobj.update(chunk)
   h=hobj.hexdigest();gitblob=gobj.hexdigest()
  assert gitblob==oid,'Working bytes differ from pinned Git blob'
  total+=size;assert total<=8589934592;records.append({'path':str(pathlib.PurePosixPath(prefix)/name),'mode':mode,'blob':oid,'sha256':h,'bytes':size})
for name in ['.env.test','.env.test.local','.env.development','.env.production','.dev.vars.production','.env.local','node_modules','vendor/eliza/node_modules','.env','.env.local','.dev.vars']:assert not(root/name).exists()and not(root/name).is_symlink()
# Reject extra retained ignored files as well as ordinary Git overlays. Only
# the canonical producer directory is excluded, then independently inventoried.
tracked={x['path']:x for x in records};expected_directories={'.'}
for name in tracked:
 parent=pathlib.PurePosixPath(name).parent
 while str(parent)!='.':expected_directories.add(str(parent));parent=parent.parent
for row in records:
 if row.get('kind')=='gitlink':expected_directories.add(row['path'])
eliza=root/'.eliza'
if eliza.exists()or eliza.is_symlink():
 assert eliza.is_dir()and not eliza.is_symlink()and set(p.name for p in eliza.iterdir())=={'client-features'},'Unexpected generated directory'
 assert(eliza/'client-features').is_dir()and not(eliza/'client-features').is_symlink(),'Linked canonical producer root'
seen_metadata=set();directory_entries=0;tracked_directory_links=[]
for current,directories,files in os.walk(root,followlinks=False):
 relative=pathlib.Path(current).relative_to(root);kept=[]
 for name in directories:
  path=str(relative/name);entry=pathlib.Path(current)/name;mode=entry.lstat().st_mode
  directory_entries+=int(path!='.eliza');assert directory_entries<=100000,'Source directory entry bound'
  assert name!='node_modules','Installed/borrowed dependency directory in no-install cone: '+path
  if name.casefold()=='.git':
   assert path in metadata_directories and stat.S_ISDIR(mode)and not stat.S_ISLNK(mode),'Unexpected nested/linked Git metadata: '+path
   seen_metadata.add(path);continue
  if path=='.eliza':assert stat.S_ISDIR(mode)and not stat.S_ISLNK(mode);continue
  if stat.S_ISLNK(mode):
   assert path in tracked and tracked[path]['mode']=='120000','Untracked ignored symlink directory: '+path
   assert hashlib.sha256(os.readlink(entry).encode()).hexdigest()==tracked[path]['sha256'];tracked_directory_links.append(path);continue
  assert stat.S_ISDIR(mode)and path in expected_directories,'Unexpected retained source directory: '+path
  kept.append(name)
 directories[:]=kept
 for name in files:
  path=str(relative/name);entry=pathlib.Path(current)/name;mode=entry.lstat().st_mode
  assert name!='node_modules'and name.casefold()!='.git','Noncanonical dependency/Git metadata file: '+path
  assert path in tracked and(stat.S_ISREG(mode)or stat.S_ISLNK(mode)),'Unexpected retained source file: '+path
assert seen_metadata==metadata_directories,'Authenticated checkout metadata missing'
text=json.dumps(records,separators=(',',':'));digest=hashlib.sha256(text.encode()).hexdigest();data={'Alpha':plan['Alpha'],'SDK':plan['SDK'],'trackedFiles':len(records),'bytes':total,'recordsDigest':digest,'allWorkingGitBlobsMatched':True,'externalJSDependenciesInstalled':False,'directoryEntriesClassified':directory_entries,'exactGitMetadataExclusions':sorted(seen_metadata),'authenticatedTrackedDirectoryLinks':sorted(tracked_directory_links)}
if output.exists():assert json.loads(output.read_text())==data
else:output.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps(data))
