#!/usr/bin/env node
import {sourceDirectory} from './local-agent-source.mjs';
import {prepareClientFeatures} from './prepare-client-features.mjs';
import {developmentSpeechEnvironment} from './dev-speech-settings.mjs';
// Owns only the two processes it starts. Credentials stay in the host profile.
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:net';
// This launcher invokes Vite directly, so npm's predev hook does not run.
prepareClientFeatures();
const profile=resolve(process.env.ALPHA_REMOTE_PROFILE||join(homedir(),'.local/share/alphaphone/browser-agent'));
const configuredEnvironment=developmentSpeechEnvironment(profile);
const port=Number(process.env.ALPHA_REMOTE_PORT||47849);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local agent port');
const source=process.env.ALPHA_ELIZA_SOURCE?resolve(process.env.ALPHA_ELIZA_SOURCE):sourceDirectory(resolve(import.meta.dirname,'..'));
if(!process.env.ALPHA_ELIZA_SOURCE)execFileSync(process.execPath,['scripts/prepare-local-agent.mjs'],{stdio:'inherit'});
if(!existsSync(join(source,'node_modules')))throw Error('Install the pinned Eliza runtime dependencies in a prepared source checkout, then set ALPHA_ELIZA_SOURCE to that checkout. Do not edit vendor/eliza.');
await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
const metadata=join(profile,'process.json');
if(existsSync(metadata)){
  const previous=JSON.parse(readFileSync(metadata,'utf8'));
  if(Number.isInteger(previous.pid))try{process.kill(previous.pid,0);throw Error('The selected local profile already has a live process. Use its existing session or a separate profile.');}catch(error){if(error.code!=='ESRCH')throw error;}
}
const env={...configuredEnvironment,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:String(port),ALPHA_ELIZA_SOURCE:source};
const children=new Set();let stopping=false;
function stop(signal='SIGTERM'){if(stopping)return;stopping=true;for(const child of children)child.kill(signal);}
function run(command,args,childEnv){const child=spawn(command,args,{stdio:'inherit',env:childEnv});children.add(child);child.on('error',error=>{console.error(error.message);process.exitCode=1;stop();});child.on('exit',code=>{children.delete(child);if(!stopping){process.exitCode=code||0;stop();}});return child;}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop());
run(process.execPath,['scripts/start-local-remote.mjs'],env);
// Development server: explicitly opts into test mocks and developer surfaces.
// Extra arguments (for example `npm run dev -- --port 5400`) go to Vite; the default port is 5317.
const viteArgs=process.argv.slice(2);
const portArgs=viteArgs.some(arg=>arg==='--port'||arg.startsWith('--port='))?[]:['--port','5317'];
console.log(`Starting the local agent on 127.0.0.1:${port} (profile ${profile}) and the development server.`);
run(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1',...portArgs,'--strictPort',...viteArgs],{
  ...env,ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_LOCAL_AGENT:'1',VITE_ALPHA_DEV_CARTESIA:env.ALPHA_DEV_CARTESIA==='1'?'1':'',ALPHA_LOCAL_AGENT_ORIGIN:`http://127.0.0.1:${port}`,ALPHA_LOCAL_AGENT_TOKEN_FILE:join(profile,'owner-token'),
});
