import hashlib,json,os,pathlib,tarfile,urllib.parse,urllib.request,sys,stat
sys_path_operator=__import__('sys').path
sys_path_operator.insert(0,str(__import__('pathlib').Path(__file__).resolve().parent))
from validate import validate,P
validate(json.loads(pathlib.Path(os.environ['ROOT_GO_JSON']).read_text()))
T=json.loads((P/'TOOLCHAIN.json').read_text())['JDK'];destination=pathlib.Path(sys.argv[1]);assert destination.is_relative_to(pathlib.Path(os.environ['RUNNER_TEMP']).resolve())and not destination.exists();destination.mkdir()
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  assert urllib.parse.urlsplit(newurl).scheme=='https';return super().redirect_request(req,fp,code,msg,headers,newurl)
archive=destination/'jdk.tar.gz';h=hashlib.sha256();count=0
with urllib.request.build_opener(Redirect()).open(T['archiveURL'],timeout=20)as response,archive.open('xb')as output:
 while chunk:=response.read(1048576):
  count+=len(chunk);assert count<=T['archiveBytes'];h.update(chunk);output.write(chunk)
assert count==T['archiveBytes']and h.hexdigest()==T['archiveSHA256']
with tarfile.open(archive,'r:gz')as tar:
 members=tar.getmembers();assert len(members)<=30000 and sum(m.size for m in members)<=2147483648
 for m in members:
  p=pathlib.PurePosixPath(m.name);assert not p.is_absolute()and '..'not in p.parts and p.parts[0]==T['archiveRoot']
  assert m.isfile()or m.isdir()or m.issym(),'Hardlinks/special archive entries not admitted'
  if m.issym():
   target=pathlib.Path(os.path.normpath(str(destination/p.parent/m.linkname)));assert not pathlib.Path(m.linkname).is_absolute()and target.is_relative_to(destination/T['archiveRoot'])
 tar.extractall(destination,members=members,filter='data')
root=destination/T['archiveRoot'];records=[]
for f in [root,*sorted(root.rglob('*'))]:
 s=f.lstat();relative=str(f.relative_to(root));assert len(records)<30000
 if stat.S_ISDIR(s.st_mode):records.append({'path':relative,'type':'directory','mode':s.st_mode&0o7777});continue
 if stat.S_ISLNK(s.st_mode):records.append({'path':relative,'type':'symlink','mode':s.st_mode&0o7777,'link':os.readlink(f)});continue
 assert stat.S_ISREG(s.st_mode);digest=hashlib.sha256()
 with f.open('rb')as stream:
  while chunk:=stream.read(1048576):digest.update(chunk)
 records.append({'path':relative,'type':'file','bytes':s.st_size,'mode':s.st_mode&0o7777,'sha256':digest.hexdigest()})
assert all((root/n).is_file()for n in ['bin/java','bin/javac','release'])
receipt={'inventoryVersion':2,'archiveBytes':count,'archiveSHA256':h.hexdigest(),'sourceURL':T['archiveURL'],'JAVA_HOME':str(root),'records':records,'toolExecuted':False}
(destination/'JDK-ARCHIVE-CUSTODY.json').write_text(json.dumps(receipt,indent=2)+'\n')
