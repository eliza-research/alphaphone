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
  'packages/contracts/src/device-action-execution.ts',
  'packages/ui/src/agent-surface/AgentSurfaceContext.hooks.ts',
  'packages/ui/src/agent-surface/registry.ts',
  'packages/ui/src/agent-surface/sensitive.ts',
  'packages/ui/src/agent-surface/types.ts',
  'packages/ui/src/agent-surface/useAgentElement.ts',
  'packages/ui/src/api/api-error.ts',
  'packages/ui/src/components/composites/page-panel/content-state.tsx',
  'packages/ui/src/components/composites/page-panel/index.ts',
  'packages/ui/src/components/composites/page-panel/page-panel-collapsible-section.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-feature-empty.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-header.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-layout.tsx',
  'packages/ui/src/components/composites/page-panel/page-panel-types.ts',
  'packages/ui/src/components/ui/badge.tsx',
  'packages/ui/src/components/ui/button.tsx',
  'packages/ui/src/components/ui/card.tsx',
  'packages/ui/src/components/ui/empty-state.tsx',
  'packages/ui/src/components/ui/skeleton-layouts.tsx',
  'packages/ui/src/components/ui/skeleton.tsx',
  'packages/ui/src/components/ui/spinner.tsx',
  'packages/ui/src/utils/cn.ts',
  'packages/ui/src/view-primitives.ts',
  'plugins/plugin-notes/src/client/notes-controller.ts',
  'plugins/plugin-notes/src/client/notes-editor.ts',
  'plugins/plugin-notes/src/client/notes-snapshot-state.ts',
  'plugins/plugin-notes/src/components/NotesSurface.tsx',
  'plugins/plugin-notes/src/components/NotesWorkspace.tsx',
  'plugins/plugin-notes/src/components/viewPrimitives.tsx',
  'plugins/plugin-notes/src/workspace.ts',

  'packages/ui/src/api/transport.ts',
  'plugins/plugin-native-system/src/client/launcher.ts',
  'plugins/plugin-native-system/src/sense.ts',
  'plugins/plugin-native-system/src/sense-bridge.ts',
  'plugins/plugin-native-system/src/sense-web.ts',
  'plugins/plugin-native-system/src/definitions.ts',
  'packages/ui/src/components/pages/InstalledAppsLauncher.tsx',
  'packages/ui/src/voice/pcm-wave.ts',
  "packages/ui/src/utils/reminder-presentation.ts",
  "plugins/plugin-browser/src/native-client-command.ts",
  'packages/core/src/types/plugin.ts',
  'packages/core/src/types/components.ts',
  'packages/core/src/types/model.ts',
  'packages/core/src/types/primitives.ts',
  'packages/ui/src/api/client-base.ts',
  'plugins/plugin-calendar/src/meetings/auto-join-settings.ts',
  'packages/core/src/types/permissions.ts',
  'packages/contracts/src/lifeops/gmail.ts',
  'packages/contracts/src/lifeops/policy.ts',
  'packages/contracts/src/lifeops/telemetry.ts',
  'packages/contracts/src/lifeops/inbox.ts',
  'packages/contracts/src/lifeops/connectors.ts',
  'packages/contracts/src/lifeops/workflows.ts',
  'packages/contracts/src/lifeops/scheduling.ts',
  'packages/contracts/src/lifeops/reminders.ts',
  'packages/contracts/src/lifeops/events.ts',
  'packages/contracts/src/lifeops/health.ts',
  'packages/contracts/src/lifeops-connector-degradation.ts',
  'packages/contracts/src/lifeops/goals.ts',

  'packages/contracts/src/calendar.ts',
  'packages/core/src/types/effects.ts',
  'plugins/plugin-assistant/src/services/device-actions/foreground-review-contract.ts',
  'plugins/plugin-calendar/src/api/calendar-api.ts',
  'plugins/plugin-calendar/src/api/client-calendar.ts',
  'plugins/plugin-calendar/src/browser.ts',
  'plugins/plugin-calendar/src/client/named-read.ts',
  'plugins/plugin-calendar/src/components/EventEditorDrawer.tsx',
  'plugins/plugin-calendar/src/components/event-editor-command.ts',
  'plugins/plugin-calendar/src/components/event-editor-policy.ts',
  'plugins/plugin-calendar/src/index.ts',
  'plugins/plugin-calendar/src/internal/time.ts',
  'plugins/plugin-calendar/src/service/managed-calendar-host.ts',
  'plugins/plugin-notes/src/capabilities.ts',
  'plugins/plugin-notes/src/client/notes-api.ts',
  'plugins/plugin-notes/src/note-authored.ts',
  'plugins/plugin-notes/src/note-format.ts',
  'plugins/plugin-notes/src/note-id.ts',
  'plugins/plugin-notes/src/types.ts',

  'packages/contracts/src/calendar-linked-sync.ts',
  'packages/ui/src/voice/batch-conversation.ts',
  'packages/ui/src/voice/voice-session-client-core.ts',
  'packages/ui/src/voice/voice-session-status.ts',
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
  'packages/core/src/logging.ts',
  'packages/core/src/view-interaction.ts',
  'packages/core/src/security/log-redaction.ts',
  'packages/host/src/voice/ui-context.ts',

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
  'plugins/plugin-assistant/src/services/device-actions/camera-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/notes-query-result.ts',
  'plugins/plugin-assistant/src/services/device-actions/sms-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/clock-contract.ts',
  'plugins/plugin-assistant/src/services/device-actions/clock-review-executor.ts',
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
  // Only non-voice client types need a consumer projection. The voice client,
  // logger contracts and renderer observations are browser-safe upstream entries.
  const project = (name, text) => source.set(name, {bytes:Buffer.from(text),mode:'100644',sha256:hash(Buffer.from(text))});
  const text = name => source.get(name).bytes.toString();

  project('client-contracts.ts', 'export * from "./packages/contracts/src/calendar";\nexport * from "./packages/contracts/src/calendar-linked-sync";\nexport * from "./packages/contracts/src/device-reviews";\n');
  // Project only existing public type declarations; do not bundle host/client implementations.
  const declarations = (name, names) => names.map(declaration => {
    const escaped = declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const content = text(name);
    const interfaces = [...content.matchAll(new RegExp('^export interface ' + escaped + '\\s*\\{[\\s\\S]*?^\\}', 'gm'))];
    const aliases = [...content.matchAll(new RegExp('^export type ' + escaped + '\\s*=[\\s\\S]*?;', 'gm'))];
    const matches = [...interfaces, ...aliases];
    if (matches.length !== 1) throw Error('Review changed client type declaration: ' + name + ':' + declaration);
    return matches[0][0];
  }).join('\n') + '\n';
  project('alpha-voice-core-types.ts',declarations(
    'packages/core/src/types/plugin.ts', ['ViewCapabilityParameter', 'ViewCapability']) + declarations(
    'packages/core/src/types/primitives.ts', ['JsonPrimitive', 'JsonValue']) + declarations(
    'packages/core/src/types/components.ts', ['ActionParameterSchema']) + declarations(
    'packages/core/src/types/model.ts', ['JSONSchema']));
  const clientName = 'packages/ui/src/api/client-base.ts';
  const fetchMatches = [...text(clientName).matchAll(/^  async fetch<T>\([\s\S]*?^  \): Promise<T> \{/gm)];
  if (fetchMatches.length !== 1) throw Error('Review changed ElizaClient fetch declaration.');
  const fetchSignature = fetchMatches[0][0].replace(/^  async /, '').replace(/ \{$/, '').trim();
  project('alpha-client-fetch-types.ts', 'export interface ElizaClient { ' + fetchSignature + '; }\n');
  project('plugins/plugin-calendar/src/meetings/auto-join-settings.ts', declarations(
    'plugins/plugin-calendar/src/meetings/auto-join-settings.ts', ['MeetingAutoJoinPolicy', 'MeetingAutoJoinSettings']));
  source.delete('packages/core/src/types/plugin.ts');
  source.delete('packages/core/src/types/components.ts');
  source.delete('packages/core/src/types/model.ts');
  source.delete('packages/core/src/types/primitives.ts');
  source.delete(clientName);

  project('alpha-voice-core-protocol.ts','export {ElizaError} from "./packages/core/src/errors";\nexport {redactTrailingArgs} from "./packages/core/src/security/log-redaction";\nexport {parseViewInteractionClientId, AGENT_SURFACE_CAPABILITY_IDS} from "./packages/core/src/views/view-interact-protocol";\nexport {findViewActionHandoff, type ViewActionHandoff} from "./packages/core/src/views/view-action-handoff";\nexport type {PermissionState} from "./packages/core/src/types/permissions";\n');


  }
  const files = Object.fromEntries([...source].map(([name, file]) => [name, file.sha256]));
  const provenance = { baseCommit: upstream.pin, sourceFiles, projectionVersion:projectVoice?10:0, files };
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
