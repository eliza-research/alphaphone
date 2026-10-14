import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Copy only the stopped synthetic capture named by this disposable-user test. */
export function collectConversationAudio(raw,output,adb,user){
 if(!/^[1-9][0-9]*$/.test(String(user))||!Number.isSafeInteger(Number(user)))throw Error('Explicit disposable user required');
 const matches=[...raw.matchAll(/^INSTRUMENTATION_RESULT: conversationAudioFixture=(.*)$/gm)];
 if(matches.length!==1)throw Error('Audio artifact receipt missing or ambiguous');
 const entries=JSON.parse(matches[0][1]);
 if(!Array.isArray(entries)||!entries.length||entries.length>4)throw Error('Invalid audio artifact count');
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 const allowed=new RegExp(`^files/conversation-audio-evidence/(${uuid})/(${uuid})\\.(m4a|wav)$`),seen=new Set(),runs=new Set();
 for(const entry of entries){const match=allowed.exec(entry?.path);if(!match||seen.has(entry.path)||!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Unadmitted audio artifact');seen.add(entry.path);runs.add(match[1]);}
 if(runs.size!==1)throw Error('Mixed audio fixture runs');
 const directory=path.join(output,'conversation-audio');if(fs.existsSync(directory))throw Error('Audio output already exists');
 const copies=entries.map(entry=>{
  const encoded=adb(['shell','run-as','ai.elizaresearch.alphaphone','--user',String(user),'base64',entry.path]).replace(/\s/g,'');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4)throw Error('Invalid encoded audio artifact');
  const bytes=Buffer.from(encoded,'base64');if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Audio artifact hash or size differs');
  return {entry,bytes};
 });
 fs.mkdirSync(directory);for(const {entry,bytes} of copies)fs.writeFileSync(path.join(directory,path.basename(entry.path)),bytes);
 fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify({user:String(user),entries},null,2)+'\n');
 return {copied:true,count:copies.length,directory};
}
