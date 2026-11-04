import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync,spawnSync}from'node:child_process';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(process.env.JAVA_TOOL_OPTIONS!=='-Xmx512m -XX:ActiveProcessorCount=2')throw Error('Wrong Java heap/CPU budget');
const expected=JSON.parse(fs.readFileSync('/results/TOOLCHAIN.json'));
const custodyFile='/results/JDK-ARCHIVE-CUSTODY.json';if(fs.lstatSync(custodyFile).isSymbolicLink()||fs.statSync(custodyFile).size>8388608)throw Error('Archive custody metadata bound');
const custody=JSON.parse(fs.readFileSync(custodyFile));
if(custody.inventoryVersion!==2||custody.archiveBytes!==expected.JDK.archiveBytes||custody.archiveSHA256!==expected.JDK.archiveSHA256||custody.sourceURL!==expected.JDK.archiveURL)throw Error('Archive receipt differs from sealed vendor supplier');
if(process.version!=='v'+expected.NodeVersion||hash('/usr/local/bin/node')!==expected.NodeBinarySHA256||process.env.JAVA_HOME!==expected.JDK.containerJAVA_HOME)throw Error('Wrong Node/JAVA_HOME supplier');
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
const versions={};for(const name of ['java','javac']){const r=spawnSync(process.env.JAVA_HOME+'/bin/'+name,['-version'],{encoding:'utf8',timeout:10000,maxBuffer:65536});if(r.error||r.signal||r.status!==0)throw Error('Tool version metadata failed');versions[name]={stdout:r.stdout,stderr:r.stderr};}
// java -version writes stderr. Release metadata independently binds the exact version.
const release=fs.readFileSync(process.env.JAVA_HOME+'/release','utf8');if(!release.includes('JAVA_VERSION="21.0.13"')||!release.includes('JAVA_RUNTIME_VERSION="21.0.13+9-LTS"')||!(versions.javac.stdout+versions.javac.stderr).includes('javac 21.0.13')||!(versions.java.stdout+versions.java.stderr).includes('Temurin-21.0.13+9'))throw Error('Wrong JDK release metadata');
const system={};for(const name of ['git','patch']){const command=execFileSync('/usr/bin/which',[name],{encoding:'utf8',timeout:10000}).trim();if(!command.startsWith('/usr/'))throw Error('Borrowed system tool');const file=fs.realpathSync(command);system[name]={command,file,sha256:hash(file),version:execFileSync(command,['--version'],{encoding:'utf8',timeout:10000}).slice(0,4096)};}
fs.writeFileSync('/results/TOOL-PROVENANCE.json',JSON.stringify({node:process.version,nodeSHA256:hash('/usr/local/bin/node'),npmSHA256:hash(fs.realpathSync('/usr/local/bin/npm')),JDKArchiveSHA256:custody.archiveSHA256,JAVA_HOME:process.env.JAVA_HOME,completeJDKInventory:{entries:actual.length,bytes:totalBytes,inventorySHA256,allBytesModesTypesLinksMatched:true,noMissingOrExtraEntries:true,archiveReceiptSHA256:hash(custodyFile)},files,release,versions,system,scope:'Actual supplied tool metadata only, not fixture or Android pass'},null,2)+'\n');
