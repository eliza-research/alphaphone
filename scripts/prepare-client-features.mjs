import { createHash } from 'node:crypto';
import { upstreamNativeSource } from './upstream-native-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
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
  'packages/core/src/utils/stage-directions.ts',
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
  'plugins/plugin-notes/src/types.ts',
  'plugins/plugin-notes/src/capabilities.ts',
  'plugins/plugin-notes/src/components/notesData.ts',
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
  if (upstream.pin !== '58dfddf87ee5adec414746a86a23dada124fbbae') throw Error('Review voice projections for the new upstream pin.');
  // The camera contract is upstream at this pin; carry it with the other device-action contracts.
  for(const [name,file] of upstream.read('plugins/plugin-assistant/src/services/device-actions/camera-contract.ts'))source.set(name,file);
  // Stock Notes capability declarations type-import ViewCapability from core; only those declarations are carried.
  const corePlugin=upstream.read('packages/core/src/types/plugin.ts').get('packages/core/src/types/plugin.ts'),pluginTypes=corePlugin.bytes.toString();
  sourceFiles['packages/core/src/types/plugin.ts']=corePlugin.sha256;

  const projectionInputs={
    'packages/host/src/voice.ts':'19b5c0e5bbe03a27d3641e6edb4ab40bc989084a2bdd5aa9308e9494843aa0b1',
    'packages/ui/src/voice/voice-session-client.ts':'0692de311d8231262af1ca2113563628836faf01c2ac7bb96f16c51ad22fd6b1',
    'packages/ui/src/voice/voice-chat-types.ts':'043e9a3cd224bc78c67e460070f4e3006120d87db50149f5e2515572eab1cd21',
    'packages/core/src/logger.ts':'8c2401ba44a79b94a11095bdce3568f65374d2d7b1421c5894b08753feafb7d1',
    'packages/core/src/types/plugin.ts':'76e82e1b2c5cfb50ecbde8e93a3c28dc053451cdbe0cd2ef4b77e0421ad16490',
    'plugins/plugin-notes/src/types.ts':'f2a9d2e20a9524f962567cbd26622d5f548ecc22f0318ea63b05d9864ce4e7d0',
    'plugins/plugin-notes/src/capabilities.ts':'60330adc8323ee525366789190f7a8fedc2e60e159af85a3ca8fd4ff6ead1dd2',
    'plugins/plugin-notes/src/components/notesData.ts':'11dcd48a784ae5c9cf6cc5d7fabdb47650a9028fc290e8eeb51adc7f2080500a',
  };
  for(const [name,digest] of Object.entries(projectionInputs))if(sourceFiles[name]!==digest)throw Error('Review changed projection input: '+name);
  const project = (name, text) => source.set(name, {bytes:Buffer.from(text),mode:'100644',sha256:hash(Buffer.from(text))});
  const text = name => source.get(name).bytes.toString();

  const clientPath='packages/ui/src/voice/voice-session-client.ts';
  const fallback='      const { fetchVoiceSession } = await import("./voice-session-fetch");\n      return fetchVoiceSession(url, init);';
  if(text(clientPath).split(fallback).length!==2)throw Error('Voice fetch projection source changed.');
  project(clientPath,text(clientPath).replace(fallback,'      void url; void init;\n      throw new Error("Alpha voice requires an injected session fetch.");'));
  const status=text('packages/ui/src/voice/voice-chat-types.ts').match(/export type VoiceContinuousStatus =[\s\S]*?;/)?.[0];
  const loggerTypes=text('packages/core/src/logger.ts');
  const start=loggerTypes.indexOf('type LogFn ='),end=loggerTypes.indexOf('/**\n * Log entry structure',start);
  const viewStart=pluginTypes.indexOf('/** Primitive JSON Schema constraints for one view-capability parameter. */'),viewEnd=pluginTypes.indexOf('/**\n * One agent-surface interaction step',viewStart);
  if(!status||start<0||end<start||viewStart<0||viewEnd<viewStart)throw Error('Voice type projection source changed.');
  project('packages/ui/src/voice/voice-chat-types.ts',status+'\n');
  source.delete('packages/core/src/logger.ts');
  project('alpha-voice-core-types.ts',loggerTypes.slice(start,end)+pluginTypes.slice(viewStart,viewEnd));
  project('alpha-voice-core-protocol.ts','export {ElizaError} from "./packages/core/src/errors";\nexport {redactTrailingArgs} from "./packages/core/src/security/log-redaction";\nexport {parseViewInteractionClientId} from "./packages/core/src/views/view-interact-protocol";\nexport {findViewActionHandoff, type ViewActionHandoff} from "./packages/core/src/views/view-action-handoff";\n');
  // The pinned upstream global renderer is byte-identical to the carried projection.
  // Stock Notes client: only its dashboard transport import is replaced by Alpha's owner-route transport.
  const notesData='plugins/plugin-notes/src/components/notesData.ts',notesImport='import { ApiError, client, fetchWithCsrf } from "@elizaos/ui";';
  if(text(notesData).split(notesImport).length!==2)throw Error('Notes transport projection source changed.');
  project(notesData,text(notesData).replace(notesImport,'import { ApiError, client, fetchWithCsrf } from "../../../../../../apps/app/src/runtime/notes-transport";'));


  }
  const files = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));
  const provenance = { baseCommit: upstream.pin, sourceFiles, projectionVersion:projectVoice?8:0, files };
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
