import {browserDevProfile as devProfileQuery} from '../browser/dev-profile';
import {testMocksEnabled,devSurfacesEnabled} from '../build-flags';
import {openCalendarRecovery} from '../browser/calendar-recovery';
import {openNotificationRecovery} from '../browser/notification-recovery';
import {openAlertSoundRecovery,openDevicePreferencesRecovery,openDeviceRolesRecovery} from '../browser/preference-recovery';
import {notificationDocument} from '../browser/notification-store';
import {alertSoundDocument,deviceRolesDocument} from '../browser/preference-documents';
import {readDevicePreferences} from '../browser/device-preferences';
import { registerPlugin } from '../platform-plugins';
import { broaderPageNotice, switchValue } from './native-adapter';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { connectionController } from '../runtime/connection-ui';
import {googleConnectionController} from '../runtime/google-connection-ui';
import {GOOGLE_ACCOUNTS_CHANGED,googleDisconnectConfirmation,googleDisconnectMessage} from '../runtime/google-accounts';
import { browserLocalAgentEnabled } from '../runtime/local-agent';
import {developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-conversation';
import type { GmailAccount } from '../runtime/cloud-protocol';
import { disconnectGmailAccount, disconnectMessage, GMAIL_ACCOUNTS_CHANGED } from '../runtime/gmail-mailbox';
import { gmailGrantLabel, gmailGrantTier } from '../runtime/gmail-grants';
import { clearCrashLog, describeCrashEntry, readCrashLog, type CrashLog } from '../runtime/crash-log';
import { buildDiagnostics, diagnosticsFileName, diagnosticsText } from '../runtime/diagnostics-export';
import { leavePasswordManager, passwordEntryPage, passwordManagerGroups, passwordManagerLifecycle, refreshPasswordManager, PASSWORD_PAGES } from '../passwords/password-manager';

type Bag = Record<string, any>;
declare const __APP_VERSION__: string;
const browserDevProfile = devSurfacesEnabled && devProfileQuery;
/** Build version injected at build time from app.config.json or ELIZAOS_VERSION_NAME. */
export const buildVersion = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'Unavailable';
export type LicenseNotice = { name: string; version: string; license: string; source: string; text: string; flags?: unknown; obligations?: unknown };
/** Labels for the flags scripts/licence-policy.mjs writes into the shipped notices. An unlisted flag is shown as written. */
const LICENSE_FLAG_LABELS: Record<string, string> = {
  'copyleft-strong': 'Copyleft (GPL family)', 'network-copyleft': 'Network copyleft (AGPL)', 'copyleft-weak': 'Weak copyleft (LGPL, MPL, EPL)',
  'share-alike-data': 'Share-alike data', 'unknown-licence': 'Unknown license', 'licence-text-missing-from-package': 'No license file in package',
  unverified: 'License unverified', 'permissive-not-previously-listed': 'Permissive, newly listed', 'non-open-source-terms': 'Not open-source terms',
  'proprietary-licence-held-outside-repo': 'Proprietary, license held by owner', 'proprietary-no-licence-recorded': 'Proprietary, no license recorded',
};
/** Rows for an entry's flags and what each obliges; none for an unflagged entry. */
function licenseFlagRows(item: LicenseNotice): Bag[] {
  const flags = Array.isArray(item.flags) ? item.flags.filter((flag): flag is string => typeof flag === 'string' && !!flag) : [];
  if (!flags.length) return [];
  const notes = (Array.isArray(item.obligations) ? item.obligations : []).filter((row): row is { flag: string; note: string } => !!row && typeof row === 'object' && typeof (row as Bag).flag === 'string' && typeof (row as Bag).note === 'string' && !!(row as Bag).note);
  return [{ kLog: true, time: 'Flagged', text: flags.map(flag => LICENSE_FLAG_LABELS[flag] ?? flag).join(' · ') }, ...notes.map(row => ({ kLog: true, time: 'Obligation', text: row.note }))];
}
let licenses: { status: 'idle' | 'loading' | 'ready' | 'unavailable'; items: LicenseNotice[] } = { status: 'idle', items: [] };
/** Reads the generated notice file shipped with the app; never a remote source. */
async function loadLicenses(changed: () => void) {
  if (licenses.status === 'loading' || licenses.status === 'ready') return;
  licenses = { status: 'loading', items: [] }; changed();
  try {
    const response = await fetch('licenses/third-party-notices.json', { cache: 'no-cache' });
    if (!response.ok) throw Error('License notices unavailable');
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw Error('License notices unavailable');
    const items = value.filter((item): item is LicenseNotice => !!item && typeof item === 'object' && ['name', 'version', 'license'].every(key => typeof (item as Bag)[key] === 'string'));
    licenses = { status: items.length ? 'ready' : 'unavailable', items };
  } catch { licenses = { status: 'unavailable', items: [] }; }
  changed();
}
type RecoveryDomain = 'notifications' | 'device settings' | 'device roles' | 'alert sound history';
const recoveryActions: Record<RecoveryDomain, { label: string; open: () => void }> = {
  notifications: { label: 'Recover notification data', open: openNotificationRecovery },
  'device settings': { label: 'Recover device settings', open: openDevicePreferencesRecovery },
  'device roles': { label: 'Recover device roles', open: openDeviceRolesRecovery },
  'alert sound history': { label: 'Recover notification sounds', open: openAlertSoundRecovery },
};
/** Browser stores report recovery when saved bytes or their metadata cannot be read normally. */
async function recoveryNeeded(): Promise<RecoveryDomain[]> {
  const probe = async (domain: { capture(signal?: AbortSignal): Promise<{ format: string; legacyChanged: boolean }>; readRaw(signal?: AbortSignal): Promise<string | null> }, validate?: () => Promise<unknown>) => {
    try {
      const captured = await domain.capture();
      if (captured.format === 'unrecognized' || captured.legacyChanged) return true;
      const raw = await domain.readRaw();
      if (raw !== null) JSON.parse(raw);
      if (validate) await validate();
      return false;
    } catch { return true; }
  };
  const checks: Array<[RecoveryDomain, Promise<boolean>]> = [
    ['notifications', probe(notificationDocument)],
    ['device settings', probe({ capture: signal => readDevicePreferences(signal).then(() => ({ format: 'domain', legacyChanged: false })), readRaw: async () => null })],
    // Simulated device roles exist only in test-mocks builds; production browsers have none to recover.
    ...(testMocksEnabled ? [['device roles', probe(deviceRolesDocument)] as [RecoveryDomain, Promise<boolean>]] : []),
    ['alert sound history', probe(alertSoundDocument)],
  ];
  const results = await Promise.all(checks.map(async ([name, check]) => [name, await check] as const));
  return results.filter(([, needed]) => needed).map(([name]) => name);
}
const device = registerPlugin<{
  snapshot(): Promise<Bag>;
  openPasswordProvider(input:{action:string}):Promise<{status:string;destination?:string}>;
  openSettings(input: { page: string }): Promise<{ status: string }>;
  setTextScale(input:{percent:number}):Promise<{textScalePercent:number;effectiveTextZoom:number}>;
  diagnosticsFacts(): Promise<Bag>;
  shareDiagnostics(input: { text: string }): Promise<{ status: string }>;
}>('AlphaDevice');
const deviceApps = registerPlugin<{ buildInfo(): Promise<{ launcher?: boolean; version?: string }> }>('DeviceApps');
const notifications = registerPlugin<{status():Promise<Bag>;openAppSettings():Promise<Bag>;openChannelSettings(input:{id:string}):Promise<{status:string}>;crossAppStatus():Promise<Bag>;notificationApps():Promise<{apps:Bag[]}>;setNotificationPolicy(input:Bag):Promise<Bag>;resumeCrossApp(input:{expectedRevision:string}):Promise<Bag>;openNotificationAccess():Promise<Bag>;notificationHistory():Promise<{items:Bag[]}>;clearNotificationHistory():Promise<void>}>('AlphaNotifications');
const speech = registerPlugin<{localSpeechStatus(input:{requestId:string}):Promise<{ready:boolean;execution:string}>}>('AlphaVoiceCloud');
const system = registerPlugin<{ getDeviceSettings(): Promise<Bag>; getStatus(): Promise<{ roles?: Bag[] }>; requestRole(input: { role: string }): Promise<{ role: string; held: boolean; resultCode: number }> }>('ElizaSystem');
type RoleRow = { role: string; held: boolean; available: boolean; holders: string[] };
/** Android role state exactly as ElizaSystem.getStatus() reports it; malformed rows are dropped. */
export function readRoles(status: unknown): Record<string, RoleRow> {
  const out: Record<string, RoleRow> = {};
  const rows = (status as { roles?: unknown })?.roles;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) if (row && typeof row.role === 'string' && typeof row.held === 'boolean' && typeof row.available === 'boolean')
    out[row.role] = { role: row.role, held: row.held, available: row.available, holders: Array.isArray(row.holders) ? row.holders.filter((h: unknown) => typeof h === 'string') : [] };
  return out;
}
export function roleValue(row: RoleRow | undefined): string {
  if (!row) return 'Unavailable';
  if (!row.available) return 'Not available on this device';
  if (row.held) return 'Alpha Phone';
  // Holder lookups are best effort (package visibility, the system resolver "android"), so an
  // empty answer never claims that no app holds the role.
  return row.holders.some(holder => holder !== 'android' && holder !== 'ai.elizaresearch.alphaphone') ? 'Another app' : 'Not Alpha Phone';
}

// settings-facts:begin (dependency-free; exercised by test/settings-truth.test.mjs)
/** Version as packaged, with Android's version code when it is a real positive integer. */
export function versionLabel(version: unknown, code: unknown): string {
  const name = typeof version === 'string' && version ? version : 'Unavailable';
  return Number.isSafeInteger(code) && (code as number) > 0 && name !== 'Unavailable' ? `${name} (${code})` : name;
}
/** Alpha has no update check: say so, and show only the install time Android recorded. */
export function updateRows(updatedAt: unknown, format: (at: number) => string = at => new Date(at).toLocaleDateString()): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (Number.isSafeInteger(updatedAt) && (updatedAt as number) > 0) rows.push(['Installed or last updated', format(updatedAt as number)]);
  rows.push(['Updates', 'Alpha does not check for updates']);
  return rows;
}
// settings-facts:end

/** Keep the reference settings components; never present fixture device facts. */
export function installSettingsAdapter(Component: any, views: Bag) {
  const definition = views.settings, render = definition.render, p = Component.prototype;
  const mount = p.componentDidMount, unmount = p.componentWillUnmount, openView = p.openView, update = p.componentDidUpdate;
  let owner: any, facts: Bag = {}, controls: Bag = {}, delivery: Bag = {}, generation = 0,scaleGeneration=0, cross:Bag={}, choices:Bag[]|null=null, history:Bag[]|null=null, notificationBusy=false;
  let passwordOpening=false;
  let recovery: RecoveryDomain[] = [];
  let capabilityAbort: AbortController | null = null;
  let gmailAccounts: GmailAccount[] = [], gmailBusy = '', gmailNotice = '', settingsApi: Bag | undefined;
  let roles: Record<string, RoleRow> | null = null, launcher: boolean | null = null, roleBusy = false, roleNotice = '';
  let crashLog: CrashLog | null = null, crashBusy = false, diagnosticsBusy = false;
  let gmail = 'Not checked', digests = 'Not checked', localSpeech = 'Not checked', speechChecking = false, speechGeneration = 0;
  let inferenceProvider = 'Not reported by agent';
  const changed = () => owner?.vset('settings', { capabilityReadAt: Date.now() });
  async function refreshCapabilities() {
    capabilityAbort?.abort(); const abort = capabilityAbort = new AbortController();
    const cloud = connectionController.getCloudClient(), workflow = connectionController.getWorkflowClient(), instance = owner;
    gmail = cloud ? 'Checking authorization…' : 'Cloud sign-in required'; gmailAccounts = [];
    digests = workflow ? 'Checking agent support…' : 'Connect an agent';
    inferenceProvider = 'Not reported by agent';
    localSpeech = 'Not checked'; speechChecking = false; ++speechGeneration; changed();
    const timeout = setTimeout(() => { abort.abort(); if (owner === instance && capabilityAbort === abort) { if (gmail === 'Checking authorization…') gmail = 'Authorization not verified'; if (digests === 'Checking agent support…') digests = 'Agent support not verified'; changed(); } }, 10000);
    try {
      await Promise.allSettled([
        (async () => {
          if (!browserLocalAgentEnabled) return;
          const agent = connectionController.getBrowserSpeechAgent();
          if (!agent) return;
          try {
            const status = await agent.request('/api/status', undefined, abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getBrowserSpeechAgent() !== agent) return;
            // This field reports the provider, not a specific model or a Cloud account.
            inferenceProvider = status.state === 'running' && status.model === 'cerebras' ? 'Cerebras' : 'Not reported by agent';
          } catch { /* Keep unverified runtime information explicitly unknown. */ }
        })(),
        (async () => {
          if (!cloud) return;
          try {
            const accounts = await cloud.client.gmailAccounts(abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getCloudClient()?.sessionId !== cloud.sessionId) return;
            gmailAccounts = accounts;
            gmail = gmailGrantLabel(accounts);
          } catch { if (owner === instance && capabilityAbort === abort) gmail = 'Authorization not verified'; }
        })(),
        (async () => {
          if (!workflow) return;
          try {
            const available = await workflow.client.hosted().available(abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getWorkflowClient()?.sessionId !== workflow.sessionId) return;
            digests = available ? 'Supported by selected agent' : 'Unavailable on selected agent';
          } catch { if (owner === instance && capabilityAbort === abort) digests = 'Agent support not verified'; }
        })(),
      ]);
    } finally { clearTimeout(timeout); if (owner === instance && capabilityAbort === abort) changed(); }
  }
  /** Explicit, confirmed disconnect followed by a read-back; never retried automatically. */
  async function disconnectGmail(account: GmailAccount) {
    const cloud = connectionController.getCloudClient(), instance = owner;
    if (!cloud || !account.connectionId || gmailBusy) return;
    if (!window.confirm(googleDisconnectConfirmation(account.label))) return;
    gmailBusy = account.connectionId; gmailNotice = ''; changed();
    try {
      const result = await disconnectGmailAccount(cloud.client, account.connectionId, new AbortController().signal);
      if (owner !== instance || connectionController.getCloudClient()?.sessionId !== cloud.sessionId) return;
      if (result.accounts) { gmailAccounts = result.accounts; gmail = gmailGrantLabel(result.accounts); }
      else gmail = 'Authorization not verified';
      gmailNotice = googleDisconnectMessage(result.outcome, account.label);
      settingsApi?.toast(gmailNotice);
      window.dispatchEvent(new CustomEvent(GMAIL_ACCOUNTS_CHANGED, { detail: { source: 'settings' } }));
      window.dispatchEvent(new Event(GOOGLE_ACCOUNTS_CHANGED));
    } catch { if (owner === instance) { gmailNotice = disconnectMessage('unconfirmed', account.label); gmail = 'Authorization not verified'; } }
    finally { gmailBusy = ''; if (owner === instance) changed(); }
  }
  async function checkSpeech() {
    if (speechChecking) return;
    const instance = owner, token = ++speechGeneration;
    speechChecking = true; localSpeech = 'Checking on this phone…'; changed();
    try {
      const status = await speech.localSpeechStatus({requestId:crypto.randomUUID()});
      if (owner === instance && token === speechGeneration) localSpeech = status.ready === true && status.execution === (Capacitor.isNativePlatform()?'device':'browser') ? (Capacitor.isNativePlatform()?'Last check: ready on this phone':'Browser audio ready') : 'Last check: not ready';
    } catch { if (owner === instance && token === speechGeneration) localSpeech = 'Not ready; try again'; }
    finally { if (owner === instance && token === speechGeneration) { speechChecking = false; changed(); } }
  }
  /** Android shows its own role dialog; the result is read back from getStatus, never assumed. */
  async function requestHome(api: Bag) {
    if (roleBusy) return;
    const instance = owner; roleBusy = true; roleNotice = ''; changed();
    try {
      await system.requestRole({ role: 'home' });
      const next = readRoles(await system.getStatus());
      if (owner !== instance) return;
      roles = next;
      roleNotice = next.home?.held ? 'Alpha Phone is your Home app' : 'Home app not changed';
      api.toast(roleNotice);
    } catch { if (owner === instance) { roleNotice = 'Home app change is unconfirmed'; api.toast('Android did not confirm a Home app change.'); } }
    finally { roleBusy = false; if (owner === instance) { changed(); void refresh(); } }
  }
  /** Redacted by construction (diagnostics-export.ts). Shared through Android's chooser or saved as a file. */
  async function exportDiagnostics(api: Bag) {
    if (diagnosticsBusy) return;
    const instance = owner, native = Capacitor.isNativePlatform(); diagnosticsBusy = true; changed();
    try {
      const [buildFacts, problems, roleState] = await Promise.allSettled([native ? device.diagnosticsFacts() : Promise.resolve({}), readCrashLog(), native ? system.getStatus() : Promise.resolve({ roles: [] })]);
      const value: Bag = buildFacts.status === 'fulfilled' ? buildFacts.value : {};
      const connection = connectionController.getSnapshot();
      const report = buildDiagnostics({
        platform: native ? 'android' : 'web',
        app: native ? { version: value.appVersion, versionCode: value.versionCode, variant: value.variant, buildType: value.buildType, testMocks: value.testMocks } : { version: buildVersion, testMocks: testMocksEnabled },
        os: native ? { androidRelease: value.androidRelease, securityPatch: value.securityPatch, sdkInt: value.sdkInt } : {},
        upstreamPin: value.upstreamPin, runtimeHashes: value.runtimeHashes,
        permissions: { ...(facts.permissions || {}), ...(typeof delivery.appEnabled === 'boolean' ? { Notifications: delivery.appEnabled && delivery.permissionGranted === true } : {}) },
        roles: roleState.status === 'fulfilled' ? Object.values(readRoles(roleState.value)) : [],
        crashes: problems.status === 'fulfilled' ? problems.value.entries : [],
        connection: { kind: connection.kind, connected: !!connection.session },
      });
      const text = diagnosticsText(report);
      if (native) {
        const result = await device.shareDiagnostics({ text });
        if (result?.status !== 'opened') throw Error('Share unconfirmed');
        if (owner === instance) api.toast('Choose where to share the diagnostics. They contain no notes, keys or account IDs.');
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = diagnosticsFileName(report); link.hidden = true;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (owner === instance) api.toast('Diagnostics saved. They contain no notes, keys or account IDs.');
      }
    } catch { if (owner === instance) api.toast('Diagnostics could not be exported.'); }
    finally { diagnosticsBusy = false; if (owner === instance) changed(); }
  }
  async function clearProblems(api: Bag) {
    if (crashBusy || !window.confirm('Clear the local problem log?')) return;
    const instance = owner; crashBusy = true; changed();
    try { await clearCrashLog(); crashLog = await readCrashLog(); if (owner === instance) api.toast('Problem log cleared'); }
    catch { if (owner === instance) api.toast('The problem log could not be cleared.'); }
    finally { crashBusy = false; if (owner === instance) changed(); }
  }
  async function refresh() {
    const instance = owner, token = ++generation;
    if (!instance) return;
    const native = Capacitor.isNativePlatform();
    const [state, settings, noticeState, crossState, metadata, roleState, build, problems] = await Promise.allSettled([device.snapshot(), system.getDeviceSettings(), notifications.status(), notifications.crossAppStatus(), history===null?Promise.resolve(null):notifications.notificationHistory(),
      // Browsers have no Android roles: the web plugin rejects, so nothing is shown there.
      native ? system.getStatus() : Promise.reject(Error('No device roles')), native && launcher === null ? deviceApps.buildInfo() : Promise.resolve(null), readCrashLog()]);
    if (owner !== instance || generation !== token) return;
    roles = roleState.status === 'fulfilled' ? readRoles(roleState.value) : null;
    if (build.status === 'fulfilled' && build.value) launcher = build.value.launcher === true;
    crashLog = problems.status === 'fulfilled' ? problems.value : null;
    facts = state.status === 'fulfilled' ? state.value : {};
    controls = settings.status === 'fulfilled' ? settings.value : {};
    delivery = noticeState.status === 'fulfilled' ? noticeState.value : {};
    cross = crossState.status === 'fulfilled' ? crossState.value : {};
    if(metadata.status==='fulfilled'&&metadata.value!==null)history=metadata.value.items;
    // Browser-only stores; native Android data has its own platform recovery.
    if(!Capacitor.isNativePlatform()){const next=await recoveryNeeded().catch(()=>[] as RecoveryDomain[]);if(owner!==instance||generation!==token)return;recovery=next;}
    instance.vset('settings', { nativeReadAt: Date.now() });
    refreshPasswordManager();
  }
  p.componentDidMount = function () {
    mount.call(this); owner = this; void refresh(); void refreshCapabilities();
    this.passwordLifecycle = passwordManagerLifecycle(changed);
    if(!Capacitor.isNativePlatform()&&!new URLSearchParams(location.search).has('theme')){
      const apply=()=>{try{const theme=localStorage.getItem('alpha.appearance.v1')==='dark'?'dark':'light';this.setState({theme,appearanceStorageRead:{theme}});}catch{/* Keep the current session theme if storage is unavailable. */}};
      this.appearanceStorageListener=(event:StorageEvent)=>{if(event.key==='alpha.appearance.v1'||event.key===null)apply();};
      this.appearanceResumeListener=apply;
      window.addEventListener('storage',this.appearanceStorageListener);
      window.addEventListener('pageshow',apply);
      apply();
    }

    let lastBinding = JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId]);
    this.settingsConnectionUnsubscribe = connectionController.subscribe(() => {
      this.vset('settings', { connectionReadAt: Date.now() });
      const next = JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId]);
      if (next !== lastBinding) { lastBinding = next; void refreshCapabilities(); }
    });
    this.googleAccountsChanged=()=>void refreshCapabilities();
    window.addEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleAccountsChanged);
    this.deviceResume = DailyApps.addListener('appResumed', () => { void refresh(); void refreshCapabilities(); }).catch(() => null);
  };
  p.componentDidUpdate = function (previousProps: Bag, previousState: Bag) {
    update?.call(this, previousProps, previousState);
    // Switching away from Settings (Home, another view) locks and forgets the password manager.
    if (typeof this.S === 'function' && this.S().view !== 'settings') leavePasswordManager();
    const theme = this.state?.theme;
    // The marker travels with React state, so queued external reads cannot echo an older theme.
    const external=this.state?.appearanceStorageRead;
    const fromStorage=external!==previousState?.appearanceStorageRead&&external?.theme===theme;
    if (!fromStorage&&(theme === 'light' || theme === 'dark') && theme !== previousState?.theme) {
      try { localStorage.setItem('alpha.appearance.v1', theme); }
      catch { this.toast('Theme changed for this session, but could not be saved.'); }
    }
  };
  p.componentWillUnmount = function () {
    if (owner === this) { capabilityAbort?.abort(); capabilityAbort = null; ++speechGeneration; owner = null; ++generation; facts = {}; controls = {}; delivery = {}; cross={}; choices=null; history=null; roles=null; crashLog=null; roleNotice=''; }
    window.removeEventListener('storage',this.appearanceStorageListener);
    window.removeEventListener('pageshow',this.appearanceResumeListener);
    this.settingsConnectionUnsubscribe?.();
    window.removeEventListener(GOOGLE_ACCOUNTS_CHANGED,this.googleAccountsChanged);
    this.passwordLifecycle?.();
    void this.deviceResume?.then((listener: any) => listener?.remove()); unmount.call(this);
  };
  p.openView = function (key: string, ...args: any[]) {
    const result = openView.call(this, key, ...args);
    if (key === 'settings') { void refresh(); void refreshCapabilities(); }
    return result;
  };
  definition.render = (state: Bag, api: Bag) => {
    settingsApi = api;
    const out = render({ ...state, acct: null, adding: false, sheet: ['conn', 'voice', 'wipe', 'wifiPw', 'forget'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    // Prototype personality values are mock-only until the agent reports them.
    out.persona = 'Voice and agent settings';
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
    const target = connection.session ? connection.name : 'Not connected';
    const runtimeLocation=!connection.session?'Not connected':connection.kind==='resident'?(Capacitor.isNativePlatform()?'On this device':'On this computer · development'):'Remote agent';
    const cloudLabel = account ? account.email||`Account ${account.userId.slice(0, 8)}` : 'Not signed in';
    const manage = (page: string) => () => void device.openSettings({ page }).then(opened => { const notice = broaderPageNotice(page, opened); if (notice) api.toast(notice); }, () => api.toast('This Android settings page is unavailable.'));
    const info = (label: string, val: string): Bag => ({ kInfo: true, label, val, hasVal: true, noAB: true });
    const nav = (label: string, page: string): Bag => ({ kNav: true, label, lbl: label, chev: true, noAB: true, go: manage(page) });
    const group = (rows: Bag[]) => ({ css: 'background:var(--s2);padding:4px 0', rows });
    const speechRows = (): Bag[] => [info('Speech', developmentCartesiaVoiceEnabled?'Cartesia · development':'Eliza Cloud (counts toward your plan)')];
    const problemCount = crashLog ? crashLog.entries.length : null;
    const problemsRow = (): Bag => ({ kNav:true, label:'Problem log', lbl:'Problem log', val: problemCount === null ? 'Unavailable' : problemCount ? `${problemCount} recorded` : 'None recorded', hasVal:true, chev:true, noAB:true, go:()=>{ api.set({ page:'problems' }); void refresh(); } });
    const diagnosticsRow = (): Bag => ({ kNav:true, label:'Export diagnostics', lbl: diagnosticsBusy ? 'Preparing diagnostics…' : 'Export diagnostics', chev:true, noAB:true, go:()=>void exportDiagnostics(api) });
    const licensesRow = (): Bag => ({ kNav:true, label:'Open source licenses', lbl:'Open source licenses', chev:true, noAB:true, go:()=>{ api.set({ page:'licenses' }); void loadLicenses(changed); } });
    const percent = typeof facts.batteryPercent === 'number' ? `${facts.batteryPercent}%` : 'Unavailable';
    const active = (key: string) => typeof facts[key] === 'boolean' ? facts[key] ? 'Active connection' : 'Not active' : 'Unavailable';
    // System switches as Android reported them (AlphaDevice.snapshot). Alpha cannot change any of
    // them; a switch Android did not answer for keeps its earlier wording and is never shown as off.
    const wifiValue = switchValue(facts.wifiEnabled, active('wifiActive'), { on: facts.wifiActive === true ? 'On · connected' : 'On' });
    const bluetoothValue = switchValue(facts.bluetoothEnabled, Capacitor.isNativePlatform() ? 'Manage in Android' : active('bluetoothActive'));
    const mobileValue = facts.airplaneMode === true ? 'Airplane mode on' : switchValue(facts.mobileDataEnabled, active('cellularActive'), { on: facts.cellularActive === true ? 'On · in use' : 'On' });
    const reported = (value: unknown) => switchValue(value, 'Not reported by Android');
    const interruptionLabels:Bag={all:'No DND suppression reported',priority:'Priority interruptions only',alarms:'Alarms only',none:'Interruptions suppressed',unknown:'Unavailable'};
    const topValues: Bag = {
      'Wi-Fi': wifiValue, 'Bluetooth': bluetoothValue, 'Mobile data': mobileValue,
      'Accounts': account ? 'Eliza Cloud connected' : 'Not signed in', 'Connections': gmail,
      'Battery': percent, 'Models': target, 'About': facts.appVersion || 'Unavailable',
      'Notifications': typeof delivery.appEnabled !== 'boolean' ? 'Unavailable' : !delivery.appEnabled || !delivery.permissionGranted ? 'App notifications off' : delivery.channels?.some((c:Bag)=>c.blocked||c.groupBlocked) ? 'Some channels blocked' : 'App notifications allowed',
      'Sound & vibration': Capacitor.isNativePlatform()?'Android settings':'App sound settings',
    };
    for (const page of out.stack) {
      if (page.isTop) {
        const native=Capacitor.isNativePlatform(), provider=facts.passwordProvider||{};
        const installation:Bag={installed:'Installed · publisher verified',disabled:'Installed but disabled',absent:'Not installed','unrecognized-publisher':'Installed · publisher not recognized',unknown:'Not checked'};
        const selection:Bag={proton:provider.installation==='installed'?'Proton Pass selected':provider.installation==='disabled'?'Proton Pass selected · app disabled':'Provider package selected · publisher not verified',other:'Another provider selected',none:'No provider selected',unknown:'Selection unavailable'};
        const action=(label:string,kind:string):Bag=>({kNav:true,label,lbl:passwordOpening?'Opening…':label,chev:true,noAB:true,go:async()=>{
          if(passwordOpening)return;passwordOpening=true;const instance=owner;changed();
          try{const result=await device.openPasswordProvider({action:kind});if(result?.status!=='opened')throw Error('Unconfirmed provider handoff');if(owner===instance&&result.destination!=='development')api.toast(result.destination==='system-settings'?'Opened Android settings. Search for passwords or autofill, then choose your provider.':'Opened provider setup. Complete or cancel there; no change is confirmed yet.');}
          catch{if(owner===instance)api.toast('Password provider setup is unavailable. No provider change is confirmed.');}
          finally{passwordOpening=false;if(owner===instance){changed();void refresh();}}
        }});
        const passwordGroup=group(browserDevProfile?[
          info('Provider',provider.installation==='installed'?'Development provider installed':'Not installed'),
          info('Selection',provider.selection==='proton'?'Development provider selected':'No provider selected'),
          info('Autofill','Sample sign-in in the development vault'),
          action('Choose password provider','settings'),
          provider.installation==='installed'?action('Open development vault','open'):action('Add development provider','install'),
        ]:[
          info('Proton Pass',native?(installation[provider.installation]||'Status unavailable'):'Managed by your browser and operating system'),
          info('Selection',native?(selection[provider.selection]||'Selection unavailable'):'Native provider status is unavailable here'),
          info('Autofill',native?(provider.support==='available'?'Available on this device':provider.support==='unavailable'?'Unavailable for this device or user':'Availability not checked'):'Use your browser’s password settings'),
          info('Vault','Confirm unlock, saved passwords and filling in your provider.'),
          info('Compatibility','Proton may show a browser warning. Check the website address before filling.'),
          ...(native?[action('Choose password provider in Android','settings'),...(provider.installation==='installed'?[action('Open Proton Pass','open')]:provider.installation==='absent'?[action('Get Proton Pass from Proton','install')]:[]),{kNav:true,label:'Refresh password provider status',lbl:'Refresh password provider status',chev:true,noAB:true,go:()=>void refresh()}]:[]),
        ]);
        page.groups.push(group([{kNav:true,label:'Calendar',lbl:'Calendar',chev:true,noAB:true,go:()=>api.set({page:'calendar'})}]));
        if(state.page==='calendar'){
          const display=views.calendar.displaySources?.(),rows:Bag[]=[info('Display only','Agent access is reviewed separately')];
          if(display){rows.push(info(display.native?'Device calendars':'In this app',display.loading?'Loading calendars…':display.status));
            rows.push({kNav:true,label:display.native?'Connect or refresh device calendars':'Refresh calendar',lbl:display.native?'Connect or refresh device calendars':'Refresh calendar',busy:display.loading,chev:true,noAB:true,go:display.connect});
            for(const source of display.sources||[])if(display.native)rows.push(info(source.name,source.account));else rows.push({kCalendarDisplay:true,label:source.name,sub:source.account,on:source.on,busy:display.loading,aria:`Show ${source.name} calendar`,track:api.track(source.on),kx:api.kx(source.on),toggle:()=>void source.change('visibility'),color:()=>void source.change('color'),colorLabel:`Change ${source.name} calendar color`,sw:({acc:'var(--acct)',fg:'var(--fg)',mut:'var(--mut)'} as Bag)[source.color]||'var(--acct)'});
            if(display.native)rows.push(info('Calendar visibility','Managed in Android Calendar'));
          }else rows.push(info('Calendar access','Not available in this version'));
          const groups=[{...group(rows),cap:'Calendars shown in Alpha',hasCap:true}];
          if(testMocksEnabled&&!Capacitor.isNativePlatform())groups.push({...group([{kNav:true,label:'Calendar backups',lbl:'Calendar backups',sub:'Events saved in this app',hasSub:true,chev:true,noAB:true,go:()=>openCalendarRecovery()}]),cap:'Saved data',hasCap:true});
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Calendar',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups});
        }
        page.groups.push(group([{kNav:true,label:'Password manager',lbl:'Password manager',chev:true,noAB:true,go:()=>api.set({page:'password-provider'})}]));
        if(PASSWORD_PAGES.includes(state.page)){
          const helpers={info,group,toast:(message:string)=>api.toast(message),set:(patch:Bag)=>api.set(patch),ic:api.ic||{}};
          // Alpha's own vault first; Proton Pass stays available as another provider.
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Password manager',hasTitle:true,backLabel:'Back to Settings',back:()=>{leavePasswordManager();api.set({page:null});},hero:{},groups:[...passwordManagerGroups(helpers),{...passwordGroup,cap:'Other password providers',hasCap:true}]});
          const entry=state.page==='password-entry'?passwordEntryPage(helpers,()=>api.set({page:'password-provider'})):null;
          if(entry)out.stack.push(entry);else if(state.page==='password-entry')queueMicrotask(()=>api.set({page:'password-provider'}));
        }else leavePasswordManager();
        if(native){
          const home=roles?.home,canRequestHome=launcher===true&&!!home&&home.available&&!home.held;
          page.groups.push(group([info('Home app',roles?roleValue(home):'Unavailable'),info('Assistant app',roles?roleValue(roles.assistant):'Unavailable'),
            ...(roleNotice?[info('Last change',roleNotice)]:[]),
            ...(canRequestHome?[{kNav:true,label:'Make Alpha your Home app',lbl:roleBusy?'Waiting for Android…':'Make Alpha your Home app',chev:true,noAB:true,go:()=>void requestHome(api)}]:[]),
            nav('Default apps in Android','default-apps')]));
        }
        page.groups.push(group([{kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))}]));
        // Every Alpha Phone signs in to Eliza Cloud and holds a plan: account, plan and sign-in expiry.
        const plan=connectionController.residentPlanSettings();
        if(plan){
          const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
          page.groups.push(group([{kNav:true,label:'Eliza Cloud account & plan',lbl:'Eliza Cloud account & plan',val:plan.keyExpiring?'Sign-in expiring':plan.plan,hasVal:true,chev:true,noAB:true,go:()=>api.set({page:'cloud-plan'})}]));
          if(state.page==='cloud-plan'){
            const rows:Bag[]=[info('Account',plan.account??(plan.offline?'Eliza Cloud unreachable':'Not signed in')),info('Plan',plan.plan)];
            if(plan.endsAt)rows.push(info(plan.status==='active'||plan.status==='trialing'||plan.status==='past_due'?'Plan runs until':'Plan ended',day(plan.endsAt)));
            if(plan.keyExpiresAt)rows.push(info(plan.keyExpiring?'Sign-in expires soon':'Sign-in expires',day(plan.keyExpiresAt)));
            const actions:Bag[]=plan.signedIn?[
              ...(plan.keyExpiring?[{kNav:true,label:'Approve this phone again',lbl:'Approve this phone again',chev:true,noAB:true,go:()=>void connectionController.residentCloudLogin()}]:[]),
              {kNav:true,label:'Redeem code',lbl:'Redeem code',chev:true,noAB:true,go:()=>connectionController.openPlan()},
              {kNav:true,label:'Manage plan',lbl:'Manage plan',chev:true,noAB:true,go:()=>void connectionController.residentManagePlan()},
              {kNav:true,label:'Sign out',lbl:'Sign out of Eliza Cloud',chev:true,noAB:true,go:()=>void connectionController.cloudSignOut()},
            ]:plan.offline?[{kNav:true,label:'Check plan again',lbl:'Check plan again',chev:true,noAB:true,go:()=>void connectionController.startLocal()}]
            :[{kNav:true,label:'Sign in with Eliza Cloud',lbl:'Sign in with Eliza Cloud',chev:true,noAB:true,go:()=>void connectionController.residentCloudLogin()}];
            out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Eliza Cloud account & plan',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[group(rows),group(actions)]});
          }
        }
        page.groups.push(group([{kNav:true,label:'Agent connection',lbl:'Agent connection',val:connectionController.getSnapshot().name,hasVal:true,chev:true,noAB:true,go:()=>connectionController.open()}]));
        if(native)page.groups.push(group([{kNav:true,label:'Reset Alpha data',lbl:'Reset Alpha data',sub:'Erase local Alpha data · device unlock required',hasSub:true,chev:true,noAB:true,go:async()=>{
          try{const result=await registerPlugin<{review():Promise<{status:string;message:string}>}>('AlphaReset').review();api.toast(result.message);}
          catch{api.toast('Reset could not be opened. No completed reset is confirmed.');}
        }}]));
        if(testMocksEnabled)page.groups.push(group([{kNav:true,label:'Try mock mode',lbl:'Try mock mode',chev:true,noAB:true,go:()=>connectionController.mock()}]));
        if(testMocksEnabled&&recovery.length)page.groups.push(group([info('Saved data needs recovery','Back up before resetting'),...recovery.map(name=>({kNav:true,label:recoveryActions[name].label,lbl:recoveryActions[name].label,chev:true,noAB:true,go:()=>recoveryActions[name].open()}))]));
        if(state.page==='problems'){
          const rows=crashLog?[...crashLog.entries].reverse().map(entry=>{const line=describeCrashEntry(entry);return {kLog:true,time:new Date(entry.at).toLocaleString(),text:`${line.title} · ${line.detail}`};}):[];
          out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Problem log',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[
            group([info('Kept on this device','Failure classes only, 30 days, no content'),...(crashLog&&!crashLog.exitHistory&&native?[info('Android exit history','Needs Android 11 or newer')]:[])]),
            group(crashLog?(rows.length?rows:[info('No problems recorded','')]):[info('Problem log unavailable','Try again later')]),
            group([diagnosticsRow(),...(crashLog?.entries.length?[{kNav:true,label:'Clear problem log',lbl:crashBusy?'Clearing…':'Clear problem log',chev:true,noAB:true,go:()=>void clearProblems(api)}]:[])]),
          ]});
        }
        if(state.page==='licenses')out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Open source licenses',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:licenses.status==='ready'?licenses.items.map(item=>group([info(item.name,`${item.version} · ${item.license}`),...licenseFlagRows(item),...(typeof item.source==='string'&&item.source?[{kLog:true,time:'Source',text:item.source}]:[]),...(typeof item.text==='string'&&item.text?[{kLog:true,time:'License',text:item.text}]:[])])):[group([info(licenses.status==='unavailable'?'License notices unavailable':'Loading license notices…',licenses.status==='unavailable'?'Reinstall or update the app to restore them':'')])]});
        if (owner?.props.systemShell === false) {
          const systemOnly = new Set(['Wi-Fi', 'Bluetooth', 'Mobile data', 'Battery', 'Sound & vibration']);
          page.groups = page.groups.map((g:Bag) => ({...g, rows:g.rows.filter((row:Bag) => !systemOnly.has(row.label))})).filter((g:Bag) => g.rows.length);
        }
        for (const g of page.groups) for (const row of g.rows) if (row.label in topValues) {
          row.val = topValues[row.label]; row.hasVal = true;
        }
        continue;
      }
      if (page.title === 'Accounts') {
        page.groups = [group([info('Eliza Cloud', cloudLabel), { kNav:true, label:'Manage Cloud account', lbl:'Manage Cloud account', chev:true, noAB:true, go:()=>connectionController.openCloudAccount() }, {kNav:true,label:'Google accounts',lbl:'Google accounts',chev:true,noAB:true,go:()=>googleConnectionController.open()}, nav('Device accounts in Android', 'accounts')])];
      } else if (page.title === 'Connections') {
        const connected = gmailAccounts.filter(a => a.connected && a.connectionId);
        page.groups = [group([{ kNav:true,label:'Manage Google accounts',lbl:'Manage Google accounts',chev:true,noAB:true,go:()=>googleConnectionController.open() },info('Gmail', gmail),
          ...connected.map(a => info(a.label, { modify: 'Connected · read and change access', readonly: 'Connected · read access', none: 'Connected · read access not granted' }[gmailGrantTier(a)])),
          ...(gmailNotice ? [info('Last change', gmailNotice)] : []),
          { kNav:true, label:'Open Inbox', lbl:'Open Inbox', chev:true, noAB:true, go:()=>api.open('inbox') },
          ...connected.map(a => { const label = `Disconnect Google account ${a.label}`; return { kNav:true, label, lbl:gmailBusy === a.connectionId ? 'Disconnecting…' : label, chev:true, noAB:true, go:()=>void disconnectGmail(a) }; }),
          { kNav:true, label:'Check Gmail connection', lbl:'Check Gmail connection', chev:true, noAB:true, go:()=>{ gmailNotice = ''; void refreshCapabilities(); } },
          info('Other connectors', 'Not connected')])];
      } else if (state.page === 'character' && page.hero?.kChar === true) {
        // The reference character page deliberately has no visible title.
        page.groups = browserDevProfile?[group([
          info('Speech','Record and review in this app'),
          {kNav:true,label:'Wake assistant',lbl:'Wake assistant',chev:true,noAB:true,go:()=>void owner?.startVoice()},
          {kNav:true,label:'Open conversation',lbl:'Open conversation',chev:true,noAB:true,go:()=>api.composeContentQuestion('')},
          {kNav:true,label:'Agent connection',lbl:'Agent connection',chev:true,noAB:true,go:()=>connectionController.open()},
          {kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))},
        ])]:[group([...speechRows(), info('Wake word', 'Not available'), { kNav:true, label:'Scheduled digests', lbl:'Scheduled digests', val:digests, hasVal:true, chev:true, noAB:true, go:()=>window.dispatchEvent(new Event('alpha:hosted-digests')) }, info('Personality settings', 'Managed by your agent')])];
      } else if (page.title === 'Battery') {
        page.hero = { ...page.hero, big: percent, sub: typeof facts.charging === 'boolean' ? facts.charging ? 'Charging' : 'On battery' : 'Battery reading unavailable', hasMeter: typeof facts.batteryPercent === 'number', meter: facts.batteryPercent ?? 0 };
        page.groups = [group([info('Battery saver', typeof facts.powerSave === 'boolean' ? facts.powerSave ? 'On' : 'Off' : 'Unavailable'), nav('Manage battery in Android', 'battery')])];
      } else if (page.title === 'About') {
        page.hero = { ...page.hero, big: facts.model || 'This phone', sub: facts.manufacturer || 'Device information unavailable' };
        page.groups = [group([
          info('Alpha Phone', versionLabel(facts.appVersion || buildVersion, facts.appVersionCode)), ...updateRows(facts.appUpdatedAt).map(([label, val]) => info(label, val)), info('Android', facts.androidRelease || 'Unavailable'),
          info('Build', facts.build || 'Unavailable'), info('Security patch', facts.securityPatch || 'Unavailable'),
          info('Runtime', 'Android app'), info('Agent execution', runtimeLocation), info('Agent', target), info('Inference model', 'Not reported by agent'),
        ]), group([problemsRow(), diagnosticsRow()]), group([nav('Android device information', 'about')]), group([licensesRow()])];
      } else if (page.title === 'Wi-Fi') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.hero = { ...page.hero, big: wifiValue, sub: 'Wi-Fi transport · network names stay in Android settings' };
        page.groups = [group([nav('Manage Wi-Fi networks', 'wifi')])];
      } else if (page.title === 'Bluetooth') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.groups = [group([...(typeof facts.bluetoothEnabled === 'boolean' ? [info('Bluetooth', bluetoothValue)] : []), info('Device connections', 'Manage in Android'), nav('Pair or manage devices', 'bluetooth')])];
      } else if (page.title === 'Mobile data') {
        page.groups = [group([info('Mobile connection', active('cellularActive')),
          ...(Capacitor.isNativePlatform() ? [info('Mobile data', reported(facts.mobileDataEnabled)), info('Airplane mode', reported(facts.airplaneMode))] : []),
          nav('Manage mobile networks', 'mobile'), ...(Capacitor.isNativePlatform() ? [nav('Airplane mode in Android', 'airplane')] : [])])];
      } else if (page.title === 'Models') {
        page.hero = { ...page.hero, big: target, sub: developmentCartesiaVoiceEnabled?'Direct Cerebras and Cartesia · development':'Conversation uses the selected agent. Voice uses Eliza Cloud.' };
        page.groups = [group([info('Connection', connection.kind), ...(browserLocalAgentEnabled ? [info('Inference provider', inferenceProvider)] : []), info('Inference model', 'Not reported by agent'), info('Voice', developmentCartesiaVoiceEnabled?'Cartesia · development':account ? 'Eliza Cloud' : 'Sign-in required'), { kNav:true, label:'Eliza Cloud account', lbl:'Eliza Cloud account', chev:true, noAB:true, go:()=>connectionController.openCloudAccount() }])];
      } else if (page.title === 'Developer') {
        page.groups = [group([info('App version', facts.appVersion || buildVersion), info('Agent memory', connection.session?'Usage not reported by agent':'Not connected')]), group([problemsRow(), diagnosticsRow()]), group([nav('Android developer settings', 'developer')])];
      } else if (page.title === 'Notifications') {
        const custom = (label:string,go:()=>void):Bag=>({kNav:true,label,lbl:label,chev:true,noAB:true,busy:notificationBusy,hasVal:notificationBusy,val:'Working…',go:()=>{if(!notificationBusy)go();}});
        const run = async (task:()=>Promise<void>)=>{if(notificationBusy)return;notificationBusy=true;changed();const current=owner;try{await task();if(owner===current)await refresh();}catch{if(owner===current)api.toast('Notification settings changed or are unavailable. Refresh and try again.');}finally{notificationBusy=false;if(owner===current)changed();}};
        const policy = (changes:Bag)=>void run(async()=>{await notifications.setNotificationPolicy({expectedRevision:cross.revision,...changes});if(changes.history===false)history=[];});
        const selected:Bag[]=cross.apps||[];
        const crossRows:Bag[]=[info('Other apps',typeof cross.accessGranted!=='boolean'?'Unavailable':!cross.enabled?'Collection off':cross.paused?(testMocksEnabled?'Paused after mock mode':'Paused · resume to collect'):!cross.accessGranted?'Android access not granted':!cross.connected?'Waiting for Android listener':'Selected apps connected'),info('Notification privacy',Capacitor.isNativePlatform()?'Android grants broad access. Alpha reads only selected apps; previews and history are separate choices.':(devSurfacesEnabled?'Preview events are stored in this app. ':'Notification events are stored in this app. ')+'Previews and metadata history are separate choices.'),info('Agent access','Notification content is not sent to your agent')];
        if(cross.revision){
          crossRows.push(custom(cross.enabled?'Turn off other-app collection':'Enable selected-app collection',()=>{
            if(Capacitor.isNativePlatform()&&!cross.enabled&&!window.confirm('Enable collection for your selected apps? Android grants broad notification access. Alpha filters to your selection before reading text. Previews and local metadata history remain separate choices.'))return;
            policy({enabled:!cross.enabled});
          }),custom(Capacitor.isNativePlatform()?'Manage notification access in Android':'Manage development notification access',()=>void run(async()=>{await notifications.openNotificationAccess();})),custom(choices?'Hide app choices':'Choose notification apps',()=>{
            if(choices){choices=null;owner?.vset('settings',{notificationChanged:Date.now()});return;}
            void run(async()=>{const next=await notifications.notificationApps();choices=next.apps;});
          }));
          if(cross.paused)crossRows.push(custom('Resume selected-app collection',()=>void run(async()=>{if(window.confirm('Resume collection of notifications from your selected apps?'))await notifications.resumeCrossApp({expectedRevision:cross.revision});})));
          for(const app of selected)crossRows.push(info(app.label,app.available===false?'App changed: remove and select again':app.preview?'Current title and text allowed':'Content hidden'),custom(`Remove ${app.label}`,()=>policy({apps:selected.filter(a=>a.packageName!==app.packageName).map(({packageName,preview})=>({packageName,preview}))})),custom(`${app.preview?'Hide':'Allow'} previews: ${app.label}`,()=>{
            if(Capacitor.isNativePlatform()&&!app.preview&&!window.confirm(`Allow current notification titles and text from ${app.label} while unlocked? They stay on this phone and are not stored in history or sent to the agent.`))return;
            policy({apps:selected.map(a=>({packageName:a.packageName,preview:a.packageName===app.packageName?!app.preview:a.preview}))});
          }));
          for(const app of choices||[])if(!selected.some(a=>a.packageName===app.packageName))crossRows.push(custom(`Select ${app.label} (${app.packageName})`,()=>policy({apps:[...selected.map(({packageName,preview})=>({packageName,preview})),{packageName:app.packageName,preview:false}]})));
          crossRows.push(info('Local metadata history',cross.historyUnavailable?'Unavailable; clear local history to reset':cross.history?'On · 100 events, 24 hours · no message text':'Off'),custom(cross.history?'Turn off local metadata history':'Enable local metadata history',()=>{
            if(Capacitor.isNativePlatform()&&!cross.history&&!window.confirm('Keep up to 100 redacted notification events for 24 hours in encrypted storage on this phone? Only selected app identity, event times and status are saved. No title or message text is stored.'))return;
            policy({history:!cross.history});
          }),custom('View local metadata history',()=>{if(notificationBusy)return;notificationBusy=true;const current=owner;void notifications.notificationHistory().then(result=>{if(owner===current){history=result.items;owner?.vset('settings',{notificationChanged:Date.now()});}}).catch(()=>api.toast('Local notification history is unavailable.')).finally(()=>{notificationBusy=false;});}),custom('Clear local metadata history',()=>{if(window.confirm('Permanently clear local notification metadata history?'))void run(async()=>{await notifications.clearNotificationHistory();history=[];});}));
          if(history!==null){if(!history.length)crossRows.push(info('History','No retained events'));for(const row of history)crossRows.push(info(row.appLabel,`${row.state} · ${new Date(row.at).toLocaleString()} · no action available`));}
        }
        page.groups = [group([info('Alpha notifications', topValues.Notifications),info('Do Not Disturb',interruptionLabels[delivery.interruption]||'Unavailable'),info('Delivery timing','Android battery policies may delay alerts'),Capacitor.isNativePlatform()?nav('Manage Alpha notifications', 'notifications'):custom('Manage Alpha notifications',()=>void run(async()=>{await notifications.openAppSettings();}))]),
          ...((delivery.channels||[]).map((channel:Bag)=>group([info(channel.name,channel.blocked?'Channel blocked':channel.groupBlocked?'Channel group blocked':!delivery.appEnabled||!delivery.permissionGranted?'App notifications off':channel.importance<=2?'Silent channel':'Channel allowed'),{kNav:true,label:`Manage ${channel.name}`,lbl:`Manage ${channel.name}`,chev:true,noAB:true,go:()=>void notifications.openChannelSettings({id:channel.id}).catch(()=>api.toast('This notification channel is unavailable.'))}]))),group(crossRows)];
      } else if (page.title === 'Privacy & data') {
        // Alpha declares no Contacts permission; Calendar is the fourth runtime grant it uses.
        const permissionLabels=new Set(['Microphone','Location','Camera','Calendar']);
        const permissionValue=(label:string)=>{
          if(!Capacitor.isNativePlatform())return ({granted:'Granted for this app',prompt:'Ask when used',denied:'Blocked by your system',unknown:'Managed by your system'} as Bag)[facts.permissionStates?.[label]]??'Managed by your system';
          if(typeof facts.permissions?.[label]!=='boolean')return 'Unavailable';
          if(label==='Location')return facts.locationAccess==='precise'?'Precise location allowed':facts.locationAccess==='approximate'?'Approximate location allowed':'Not allowed';
          return facts.permissions[label]?'Allowed for Alpha':'Not allowed';
        };
        // Keep connection privacy and Activity; replace only prototype permission rows.
        page.groups=page.groups.map((g:Bag)=>{
          if(!g.rows.some((row:Bag)=>permissionLabels.has(row.label)||row.label==='Contacts'))return g;
          const rows=g.rows.filter((row:Bag)=>row.label!=='Contacts').map((row:Bag)=>permissionLabels.has(row.label)?info(row.label,permissionValue(row.label)):row);
          if(!rows.some((row:Bag)=>row.label==='Calendar'))rows.push(info('Calendar',permissionValue('Calendar')));
          return {...g,rows};
        });
        page.groups.push(group([...(Capacitor.isNativePlatform()?[info('Device location',reported(facts.locationEnabled)),nav('Location in Android','location')]:[]),nav('Manage Alpha permissions','privacy')]));
      } else if (page.title === 'Sound & vibration') {
        const volume = (label: string, stream: string) => {
          const value = controls.volumes?.find((v: Bag) => v.stream === stream);
          return info(label, value && value.max > 0 ? `${Math.round(value.current * 100 / value.max)}%` : 'Unavailable');
        };
        page.groups = [group([volume('Media', 'music'), volume('Ring', 'ring'), volume('Alarm', 'alarm')]), group([...(Capacitor.isNativePlatform() ? [info('Do Not Disturb', interruptionLabels[delivery.interruption ?? facts.interruptionFilter] || 'Unavailable'), nav('Do Not Disturb in Android', 'dnd')] : []), nav('Manage sound in Android', 'sound')])];
      } else if (page.title === 'Display') {
        page.hero={...page.hero,sub:Capacitor.isNativePlatform()?'Alpha app text · Android accessibility scale also applies':'Alpha app text size',subCss:'font-size:13px;color:var(--fg)'};
        for (const g of page.groups) g.rows = g.rows.map((row: Bag) => {
          if(row.label==='Brightness')return {...nav('Manage brightness in Android','display'),...(typeof facts.adaptiveBrightness==='boolean'?{val:facts.adaptiveBrightness?'Adaptive brightness on':'Adaptive brightness off',hasVal:true}:{})};
          if(row.label!=='Text size')return row;
          if(!Number.isInteger(facts.textScalePercent))return info('Text size','Native setting unavailable');
          const percent=facts.textScalePercent;
          return {...row,valueLabel:`${percent}%`,v:percent<=100?(percent-75)*2:percent-50,set:(event:Event)=>{
            const value=Number((event.target as HTMLInputElement).value),requested=Math.round(value<=50?75+value/2:value+50),token=++scaleGeneration,instance=owner;
            ++generation;void device.setTextScale({percent:requested}).then(result=>{if(owner===instance&&token===scaleGeneration){facts={...facts,...result};instance?.vset('settings',{nativeReadAt:Date.now()});}}).catch(()=>{if(owner===instance&&token===scaleGeneration)api.toast('Text size could not be saved.');});
          }};
        });
      }
    }
    if(!Capacitor.isNativePlatform()) {
      for(const page of out.stack){
        if(page.title==='About')page.groups=[group([info('Alpha Phone',buildVersion),...updateRows(undefined).map(([label,val])=>info(label,val)),info('Runtime',devSurfacesEnabled?'Development preview':'Web app'),info('Agent execution',runtimeLocation),info('Agent',target),info('Inference model','Not reported by agent'),info('Storage','App storage')]),group([problemsRow(),diagnosticsRow()]),group([licensesRow()])];
      }
      const browserLabels=(value:any):any=>{if(typeof value==='string')return value.replaceAll('Manage brightness in Android','Brightness').replaceAll('Manage sound in Android','Sound settings').replace(/^Unavailable$/,'Managed by your system').replaceAll('Manage in Android','App settings').replaceAll('Device accounts in Android','System accounts').replaceAll('Wi-Fi transport · network names stay in Android settings','Network names stay in system settings').replaceAll('in Android','in system settings').replaceAll('Android settings','System settings').replaceAll('Android Calendar','App calendar').replaceAll('Android device information','System information').replaceAll('Android developer settings','App development settings').replaceAll('On this phone','In this app').replaceAll('on this phone','in this app').replaceAll('Android access not granted','Development event access off').replaceAll('Waiting for Android listener','Waiting for local events').replaceAll('Selected apps connected','Selected development apps connected').replaceAll('Android battery policies may delay alerts','Alerts appear while Alpha is open').replaceAll('Native setting unavailable','Managed by your system');if(Array.isArray(value))return value.map(browserLabels);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,browserLabels(v)]));return value;};
      return browserLabels(out);
    }
    return out;
  };
}
