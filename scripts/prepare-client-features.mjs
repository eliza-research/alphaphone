import { createHash } from 'node:crypto';
import { upstreamNativeSource } from './upstream-native-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function regularPath(filename, directory = false) {
  try {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw Error('Nonregular client feature path: ' + filename);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function inventory(directory) {
  const files = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw Error('Symlink in client feature source: ' + file);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files[path.relative(directory, file)] = hash(fs.readFileSync(file));
      else throw Error('Nonregular client feature source: ' + file);
    }
  }
  visit(directory);
  return files;
}
function matches(actual, expected) {
  return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([file, digest]) => actual[file] === digest);
}
export const CLIENT_FEATURE_PATHS = [
  'packages/contracts/src/calendar-linked-sync.ts',
  'packages/ui/src/voice/batch-conversation.ts',
  'packages/ui/src/voice/voice-session-client.ts',
  'packages/ui/src/voice/voice-session-protocol.ts',
  'packages/ui/src/voice/voice-session-state.ts',
  'packages/ui/src/voice/voice-session-ownership.ts',
  'packages/ui/src/voice/voice-session-mic-capture.ts',
  'packages/ui/src/voice/voice-session-playback.ts',
  'packages/ui/src/voice/voice-session-pcm.ts',
  'packages/ui/src/voice/browser-audio-runtime.ts',
  'packages/ui/src/voice/audio-worklet-module-urls.ts',
  'packages/ui/src/voice/worklets',
  'packages/ui/src/logger.ts',
  'packages/ui/src/voice/voice-chat-types.ts',
  'packages/core/src/logger.ts',
  'packages/core/src/security/log-redaction.ts',
  'packages/host/src/voice.ts',

  'packages/ui/src/voice/voice-activity.ts',
  'packages/ui/src/voice/tts-playback-activity.ts',
  'packages/ui/src/voice/end-of-turn.ts',
  'packages/ui/src/voice/voice-chat-playback.ts',
  'packages/ui/src/voice/speech-segments.ts',
  'packages/voice/src/turn.ts',
  'packages/voice/src/browser-capture',
  'packages/voice/src/respond-gate.ts',
  'packages/voice/src/voice-eot.ts',
  'packages/core/src/speech.ts',
  'packages/core/src/utils/string-boundaries.ts',
  'packages/core/src/spoken-text.ts',
  'packages/core/src/utils/reasoning-tags.ts',
  'packages/core/src/errors.ts',
  'packages/core/src/utils/errors.ts',
  'packages/ui/src/components/shell/chat-overlay-motion.ts',
  'packages/ui/src/components/shell/use-pull-gesture.ts',
  'packages/ui/src/gestures/constants.ts',
  'packages/ui/src/gestures/lost-capture.ts',
  'packages/ui/src/gestures/recognizers.ts',
  'packages/ui/src/gestures/useRafCoalescer.ts',
  'packages/ui/src/components/shell/chat-panel-layout.ts',
  'packages/ui/src/utils/automation-feed-filter.ts',
  'packages/ui/src/utils/cron-format.ts',
  'packages/core/src/events.ts',
  'packages/core/src/i18n/language.ts',
  'packages/core/src/views/view-interact-protocol.ts',
  'packages/core/src/views/view-action-handoff.ts',
  'packages/core/src/views/completed-action-navigation.ts',
  'packages/ui/src/platform/browser-document-store.ts',
  'packages/contracts/src/native-notes-query.ts',
  'packages/contracts/src/device-reviews.ts',
  'packages/contracts/src/calendar-linked-sync.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts',
  'plugins/plugin-assistant/src/services/device-actions/sms-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts',
  'plugins/plugin-files',
  'plugins/plugin-maps/src/client',
  'plugins/plugin-maps/test/navigation-client.test.mjs',
  'plugins/plugin-notes/src/client',
  'plugins/plugin-notes/test/device-query.test.mjs',
  'plugins/plugin-notes/test/notes-trash-policy.test.mjs',
  'plugins/plugin-notes/test/notes-trash-maintenance.test.mjs',
  'plugins/plugin-notes/test/notes-trash-schedule.test.mjs',
];
/** Copy authenticated upstream source outside the immutable vendor checkout. */
export function prepareClientFeatures({ root = projectRoot, projectVoice = true } = {}) {
  const upstream = upstreamNativeSource(root);
  const source = new Map(CLIENT_FEATURE_PATHS.flatMap(prefix => [...upstream.read(prefix)]));
  const sourceFiles = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));


  if(projectVoice){
  // Browser consumer projections retain the canonical implementations and exact type declarations.
  // The dashboard transport is unavailable here: Alpha must inject its owned, private fetch.
  if (upstream.pin !== '080adfc5c5822602321d1125f12f25e6f20340c2') throw Error('Review voice projections for the new upstream pin.');
  const cameraContract=JSON.parse(fs.readFileSync(path.join(root,'patches/eliza/client-camera-contract.json'),'utf8'));
  const cameraBytes=fs.readFileSync(path.join(root,'patches/eliza/client-camera-contract.ts'));
  if(cameraContract.baseCommit!==upstream.pin||cameraContract.path!=='plugins/plugin-assistant/src/services/device-actions/camera-contract.ts'||hash(cameraBytes)!==cameraContract.sha256)throw Error('Camera contract projection changed');
  source.set(cameraContract.path,{bytes:cameraBytes,mode:'100644',sha256:cameraContract.sha256});

  const projectionInputs={
    'packages/host/src/voice.ts':'6dc46172e55c3e3fcac3e5b548b7f5e5c9bbda7cd12792f43f0ee807d48df1f6',
    'packages/ui/src/voice/voice-session-client.ts':'1de275fc7c6bc1871d13d37ee42298db3cbb2ec546795417ed9df512606b4081',
    'packages/ui/src/voice/voice-chat-types.ts':'043e9a3cd224bc78c67e460070f4e3006120d87db50149f5e2515572eab1cd21',
    'packages/core/src/logger.ts':'8c2401ba44a79b94a11095bdce3568f65374d2d7b1421c5894b08753feafb7d1',
    'plugins/plugin-maps/src/client/navigation-relay.ts':'2742e4d581c1e9177fdf334199a564df02cd8f707263d62e861489f2cb40a7bd',
  };
  for(const [name,digest] of Object.entries(projectionInputs))if(sourceFiles[name]!==digest)throw Error('Review changed voice projection input: '+name);
  const project = (name, text) => source.set(name, {bytes:Buffer.from(text),mode:'100644',sha256:hash(Buffer.from(text))});
  const text = name => source.get(name).bytes.toString();
  // Preserve Alpha's existing explicit renderer claim/ack protocol through the
  // canonical browser voice parser. This chooses delivery, never authority.
  const voiceContextPath='packages/host/src/voice.ts';
  project(voiceContextPath,text(voiceContextPath)
    .replace('  uiBrowserSurface?: "native";', '  uiBrowserSurface?: "native";\n  /** Existing renderer claim/ack delivery protocol; not navigation authority. */\n  viewDelivery?: "completed-action";')
    .replace('  if (source.uiClientId !== undefined) {', '  if (source.viewDelivery !== undefined) {\n    if (source.viewDelivery !== "completed-action") return null;\n    result.viewDelivery = "completed-action";\n  }\n  if (source.uiClientId !== undefined) {'));
  // Apply the reviewed shared voice delta before the existing injected-fetch projection.
  // This carries the capture lease fix and prepared navigation protocol together.
  const voicePatchRoot=path.join(root,'patches/eliza');
  const applyVoiceProjection=(patchName,expectedPaths)=>{
  const voiceProjection=JSON.parse(fs.readFileSync(path.join(voicePatchRoot,patchName+'.json'),'utf8'));
  const voicePatch=path.join(voicePatchRoot,patchName+'.patch');
  if(voiceProjection.baseCommit!==upstream.pin||hash(fs.readFileSync(voicePatch))!==voiceProjection.patchSha256||voiceProjection.paths.length!==expectedPaths.length||voiceProjection.paths.some(row=>!expectedPaths.includes(row.path)||source.get(row.path)?.sha256!==row.beforeSha256))throw Error('Review changed shared voice navigation projection input');
  const voiceStage=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-voice-navigation-projection-'));
  try{
    for(const row of voiceProjection.paths){const target=path.join(voiceStage,row.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source.get(row.path).bytes);}
    execFileSync('patch',['--batch','--fuzz=0','--forward','-p1','--input',voicePatch],{cwd:voiceStage,stdio:'pipe',timeout:30000});
    for(const row of voiceProjection.paths){const bytes=fs.readFileSync(path.join(voiceStage,row.path));if(hash(bytes)!==row.afterSha256)throw Error('Shared voice navigation projection output changed');project(row.path,bytes.toString());}
  }finally{fs.rmSync(voiceStage,{recursive:true,force:true});}
  };
  for(const [patchName,expectedPaths] of [
    ['client-voice-prepared-navigation',['packages/ui/src/voice/voice-session-client.ts','packages/ui/src/voice/voice-session-protocol.ts']],
    ['client-voice-microphone-readiness',['packages/ui/src/voice/voice-session-mic-capture.ts']],
    ['client-voice-capture-lifecycle',['packages/ui/src/voice/voice-session-mic-capture.ts']],
    ['client-voice-requested-actions',['packages/host/src/voice.ts','packages/ui/src/voice/voice-session-protocol.ts']],
    ['client-voice-credit-terminal',['packages/ui/src/voice/voice-session-client.ts']],
    ['client-voice-context-loss',['packages/ui/src/voice/voice-session-client.ts']],
  ])applyVoiceProjection(patchName,expectedPaths);
  // Older Android WebViews inject signal composition without changing relay authority or behavior.
  const relayPath='plugins/plugin-maps/src/client/navigation-relay.ts',relay=text(relayPath);
  if(relay.split('AbortSignal.any(').length!==3||relay.split('  current(): Owner | null;').length!==2)throw Error('Maps signal projection source changed.');
  project(relayPath,relay.replace('  current(): Owner | null;','  anySignal?(signals: AbortSignal[]): AbortSignal;\n  current(): Owner | null;').replaceAll('AbortSignal.any(','(host.anySignal ?? AbortSignal.any)('));

  const clientPath='packages/ui/src/voice/voice-session-client.ts';
  const fallback='      const { fetchVoiceSession } = await import("./voice-session-fetch");\n      return fetchVoiceSession(url, init);';
  if(text(clientPath).split(fallback).length!==2)throw Error('Voice fetch projection source changed.');
  project(clientPath,text(clientPath).replace(fallback,'      void url; void init;\n      throw new Error("Alpha voice requires an injected session fetch.");'));
  applyVoiceProjection('client-voice-capture-retirement',[clientPath]);
  const status=text('packages/ui/src/voice/voice-chat-types.ts').match(/export type VoiceContinuousStatus =[\s\S]*?;/)?.[0];
  const loggerTypes=text('packages/core/src/logger.ts');
  const start=loggerTypes.indexOf('type LogFn ='),end=loggerTypes.indexOf('/**\n * Log entry structure',start);
  if(!status||start<0||end<start)throw Error('Voice type projection source changed.');
  project('packages/ui/src/voice/voice-chat-types.ts',status+'\n');
  source.delete('packages/core/src/logger.ts');
  project('alpha-voice-core-types.ts',loggerTypes.slice(start,end));
  project('alpha-voice-core-protocol.ts','export {ElizaError} from "./packages/core/src/errors";\nexport {redactTrailingArgs} from "./packages/core/src/security/log-redaction";\nexport {parseViewInteractionClientId} from "./packages/core/src/views/view-interact-protocol";\nexport {findViewActionHandoff, type ViewActionHandoff} from "./packages/core/src/views/view-action-handoff";\n');
  // The pinned upstream global renderer is byte-identical to the carried projection.


  }
  const files = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));
  const provenance = { baseCommit: upstream.pin, sourceFiles, projectionVersion:projectVoice?5:0, files };
  const parent = path.join(root, '.eliza'), destination = path.join(parent, 'client-features');
  regularPath(parent, true);
  const exists = regularPath(destination, true), stamp = path.join(destination, '.source.json');
  if (exists) {
    if (!regularPath(stamp)) throw Error('Refusing to replace an unrecognized client feature directory.');
    const previous = JSON.parse(fs.readFileSync(stamp));
    const actual = inventory(destination); delete actual['.source.json'];
    if (previous.baseCommit === upstream.pin && previous.projectionVersion === provenance.projectionVersion && matches(previous.files || {}, files) && matches(actual, files)) return destination;
  }
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, 'client-features-stage-'));
  try {
    for (const [name, file] of source) {
      const target = path.join(temporary, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.bytes, { mode: parseInt(file.mode, 8) });
    }
    if (!matches(inventory(temporary), files)) throw Error('Client feature source copy failed authentication.');
    fs.writeFileSync(path.join(temporary, '.source.json'), JSON.stringify(provenance, null, 2));
    fs.rmSync(destination, { force: true, recursive: true });
    fs.renameSync(temporary, destination);
    return destination;
  } finally { fs.rmSync(temporary, { force: true, recursive: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Client feature source prepared: ${prepareClientFeatures()}`);
}
