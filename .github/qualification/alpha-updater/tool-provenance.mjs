import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync,spawnSync}from'node:child_process';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let stage='start';const facts={};
function checkpoint(next,values={}){stage=next;Object.assign(facts,values);const text=JSON.stringify({state:'ACTUAL_POSITIVE_TOOL_METADATA_PARTIAL_NOT_QUALIFICATION',stage,facts},null,2)+'\n';if(Buffer.byteLength(text)>131072)throw Error('Tool checkpoint bound');fs.writeFileSync('/results/TOOL-PROVENANCE-PARTIAL.json',text);}
function metadata(command,args){const row=spawnSync(command,args,{encoding:'utf8',timeout:10000,maxBuffer:65536});if(row.error||row.signal||row.status!==0)throw Error('Tool metadata command failed: '+command+' '+args.join(' '));return{stdout:row.stdout,stderr:row.stderr};}
try{
if(process.env.JAVA_TOOL_OPTIONS!=='-Xmx512m -XX:ActiveProcessorCount=2')throw Error('Wrong Java heap/CPU budget');
checkpoint('node-and-supplier-check');
const expected=JSON.parse(fs.readFileSync('/results/TOOLCHAIN.json'));
const custodyFile='/results/JDK-ARCHIVE-CUSTODY.json';if(fs.lstatSync(custodyFile).isSymbolicLink()||fs.statSync(custodyFile).size>8388608)throw Error('Archive custody metadata bound');
const custody=JSON.parse(fs.readFileSync(custodyFile));
if(custody.inventoryVersion!==2||custody.archiveBytes!==expected.JDK.archiveBytes||custody.archiveSHA256!==expected.JDK.archiveSHA256||custody.sourceURL!==expected.JDK.archiveURL)throw Error('Archive receipt differs from sealed vendor supplier');
if(process.version!=='v'+expected.NodeVersion||hash('/usr/local/bin/node')!==expected.NodeBinarySHA256||process.env.JAVA_HOME!==expected.JDK.containerJAVA_HOME)throw Error('Wrong Node/JAVA_HOME supplier');
checkpoint('vendor-jdk-archive-bound',{node:process.version,nodeSHA256:hash('/usr/local/bin/node'),archiveSHA256:custody.archiveSHA256,archiveBytes:custody.archiveBytes,JAVA_HOME:process.env.JAVA_HOME});
if(!Array.isArray(custody.records)||custody.records.length>30000)throw Error('JDK inventory count bound');
const rows=new Map();for(const row of custody.records){if(typeof row.path!=='string'||row.path.startsWith('/')||row.path.split('/').some(p=>p==='..')||rows.has(row.path))throw Error('Invalid/duplicate archive inventory path');rows.set(row.path,row);}
const actual=[],files={},buffer=Buffer.alloc(1048576);let totalBytes=0;
function digestFile(file,size){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),digest=crypto.createHash('sha256');try{const before=fs.fstatSync(fd);if(!before.isFile()||before.size!==size)throw Error('JDK file type/size changed');let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,n));const after=fs.fstatSync(fd);if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('JDK read race');}finally{fs.closeSync(fd);}return digest.digest('hex');}
function walk(file,relative){
 const stat=fs.lstatSync(file),want=rows.get(relative);if(!want||actual.length>=30000)throw Error('Extra JDK entry or inventory bound');
 const mode=stat.mode&0o7777;if(mode!==want.mode)throw Error('JDK mode differs from archive');
 let row;if(stat.isSymbolicLink()){
  const link=fs.readlinkSync(file),resolved=fs.realpathSync(file);if(want.type!=='symlink'||link!==want.link||!resolved.startsWith(process.env.JAVA_HOME+'/'))throw Error('JDK link differs or escapes archive root');row={path:relative,type:'symlink',mode,link};
 }else if(stat.isDirectory()){
  if(want.type!=='directory')throw Error('JDK directory type mismatch');row={path:relative,type:'directory',mode};
 }else{
  if(!stat.isFile()||want.type!=='file'||stat.size!==want.bytes||typeof want.sha256!=='string'||!/^[a-f0-9]{64}$/.test(want.sha256))throw Error('JDK regular file mismatch');
  totalBytes+=stat.size;if(totalBytes>2147483648)throw Error('JDK byte bound');const digest=digestFile(file,stat.size);if(digest!==want.sha256)throw Error('JDK runtime byte mismatch');row={path:relative,type:'file',bytes:stat.size,mode,sha256:digest};
 }
 actual.push(row);
 if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())walk(file+'/'+name,relative==='.'?name:relative+'/'+name);
}
walk(process.env.JAVA_HOME,'.');if(actual.length!==rows.size)throw Error('Missing JDK archive entries');
for(const name of ['bin/java','bin/javac','release']){const want=rows.get(name),file=process.env.JAVA_HOME+'/'+name;if(want?.type!=='file'||fs.realpathSync(file)!==file)throw Error('Wrong executable/release origin');files[name]={file,sha256:want.sha256,bytes:want.bytes};}
const sort=rows=>JSON.stringify([...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0));
const inventorySHA256=crypto.createHash('sha256').update(sort(actual)).digest('hex');
if(sort(actual)!==sort(custody.records))throw Error('Complete JDK archive/image inventory differs');
// No Java or javac subprocess occurs until every runtime/library/config entry
// has matched archive bytes, mode and link target with no missing/extra paths.
checkpoint('complete-jdk-inventory-verified',{completeJDKInventory:{entries:actual.length,bytes:totalBytes,inventorySHA256,allBytesModesTypesLinksMatched:true,noMissingOrExtraEntries:true,archiveReceiptSHA256:hash(custodyFile)},files});
const versions={};for(const name of ['java','javac']){
 checkpoint(name+'-version-start');versions[name]=metadata(process.env.JAVA_HOME+'/bin/'+name,['-version']);
 if(!(versions[name].stdout+versions[name].stderr).includes(name==='java'?'Temurin-21.0.13+9':'javac 21.0.13'))throw Error('Wrong exact JDK tool version');
 checkpoint(name+'-version-verified',{[name+'Version']:versions[name]});
}
const release=fs.readFileSync(process.env.JAVA_HOME+'/release','utf8');if(!release.includes('JAVA_VERSION="21.0.13"')||!release.includes('JAVA_RUNTIME_VERSION="21.0.13+9-LTS"'))throw Error('Wrong JDK release metadata');
checkpoint('jdk-release-verified',{release});
const system={};
function selectedFromPATH(name){
 for(const dir of process.env.PATH.split(':')){
  if(!dir.startsWith('/'))throw Error('Relative PATH is not admitted');
  const file=dir+'/'+name;try{fs.accessSync(file,fs.constants.X_OK);if(fs.statSync(file).isFile())return file;}catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes(error.code))throw error;}
 }
 throw Error('Required image tool not found on exact container PATH: '+name);
}
for(const name of ['git','patch']){
 checkpoint(name+'-availability-start');
 const command=selectedFromPATH(name),file=fs.realpathSync(command);
 if(file!=='/usr/bin/'+name)throw Error('Tool is not the canonical full-image package executable');
 const version=metadata(command,['--version']);if(name==='git'&&!version.stdout.startsWith('git version '))throw Error('Wrong Git implementation');if(name==='patch'&&!version.stdout.includes('GNU patch '))throw Error('Wrong patch implementation');
 const packageOwner=metadata('/usr/bin/dpkg-query',['-S',file]);if(!packageOwner.stdout.split('\n').some(row=>row===name+': '+file))throw Error('Wrong package owner');
 const packageMetadata=metadata('/usr/bin/dpkg-query',['-W','-f','${Package}\t${Version}\t${Architecture}\t${Depends}\n',name]);
 const loader=metadata('/usr/bin/ldd',[file]);if(loader.stdout.includes('not found')||loader.stderr.includes('not found'))throw Error('Missing dynamic dependency');
 const runtimeFiles=[];for(const line of loader.stdout.split('\n')){
  if(!line.trim())continue;
  if(/^\s*linux-vdso\.so[.0-9]* \(0x[a-f0-9]+\)\s*$/.test(line))continue;
  const match=line.match(/(?:=>\s*)?(\/[^\s]+)\s+\(0x[a-f0-9]+\)\s*$/);if(!match)throw Error('Unknown dynamic-loader mapping');
  const runtimeFile=fs.realpathSync(match[1]);if(!runtimeFile.startsWith('/usr/lib/')&&!runtimeFile.startsWith('/lib/'))throw Error('Dependency outside supplied image');runtimeFiles.push({declared:match[1],file:runtimeFile,sha256:hash(runtimeFile)});
 }
 if(!runtimeFiles.length)throw Error('No dynamic dependency mappings observed');
 system[name]={command,file,sha256:hash(file),version,packageOwner,packageMetadata,loader,runtimeFiles,fullImageSupplier:expected.nodeImageDigest};checkpoint(name+'-runtime-verified',{[name+'Tool']:system[name]});
}
checkpoint('git-owner-and-readonly-source-start');
const uid=process.getuid();if(uid===0)throw Error('Expected numeric nonroot UID');
for(const key of ['GIT_CONFIG_COUNT','GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_PARAMETERS','GIT_DIR','GIT_WORK_TREE','SUDO_UID','LD_PRELOAD','LD_LIBRARY_PATH'])if(process.env[key])throw Error('Inherited tool ownership/loader override');
if(process.env.GIT_OPTIONAL_LOCKS!=='0')throw Error('Read-only Git metadata policy missing');
const safe=spawnSync(system.git.command,['config','--show-origin','--get-all','safe.directory'],{encoding:'utf8',timeout:10000,maxBuffer:65536});
if(safe.error||safe.signal||safe.status!==1||safe.stdout||safe.stderr)throw Error('Unexpected protected safe.directory exception; ownership proof required');
const ownership=[];for(const [root,head]of[['/workspace','8c30b83c5156fdb963daa03fd8452a892e5fa188'],['/workspace/vendor/eliza','ff04a558747ed426d9d871a319f7b3946f7660e6']]){
 for(const path of[root,root+'/.git']){const stat=fs.lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==uid)throw Error('Git root/metadata not owned by actual container UID');ownership.push({path,uid:stat.uid,gid:stat.gid});}
 const revision=metadata(system.git.command,['-C',root,'rev-parse','HEAD']);if(revision.stdout.trim()!==head)throw Error('Wrong source revision under real nonroot Git');
 const status=metadata(system.git.command,['-C',root,'status','--porcelain','--untracked-files=normal']);if(status.stdout.trim())throw Error('Dirty source checkout');
}
checkpoint('git-ownership-default-safety-verified',{GitOwnership:{containerUID:uid,paths:ownership,safeDirectoryExceptions:[],safeDirectoryConfigurationWritten:false,normalHelperUnmodified:true,optionalLocks:'0'}});
const result={node:process.version,nodeSHA256:hash('/usr/local/bin/node'),npmSHA256:hash(fs.realpathSync('/usr/local/bin/npm')),JDKArchiveSHA256:custody.archiveSHA256,JAVA_HOME:process.env.JAVA_HOME,completeJDKInventory:facts.completeJDKInventory,files,release,versions,system,GitOwnership:facts.GitOwnership,scope:'Actual complete pinned tool/runtime inventory and same-UID Git metadata only; not a fixture or Android pass'};
fs.writeFileSync('/results/TOOL-PROVENANCE.json',JSON.stringify(result,null,2)+'\n');checkpoint('all-required-tool-provenance-complete');
}catch(error){
 checkpoint(stage,{failure:{name:error.name,message:String(error.message).slice(0,4096),code:error.code??null}});throw error;
}
