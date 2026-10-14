import {automationsRouteAllowed, type AutomationsMethod} from './automations-route-policy.ts';
import {iconStyle} from '../icon-style';
import {validateUuid} from '../../../../vendor/eliza/packages/core/src/utils/uuid';
import type {ConversationMessageTarget, ChatChannel, VoiceConversationBinding,VoiceTurnSignal,ReadReplyBinding,NativeNotesReadReplyHint} from './alpha-client';
import {ViewNavigationClient} from './view-navigation';
import {captureConversationChoice,selectConversation,conversationSelectionDocument} from './conversation-selection';
import {developmentDigestDocument} from '../browser/development-digest-document';
import {developmentExecutionDocument} from '../browser/development-execution-document';
import {developmentAgentDocument} from '../browser/development-agent-document';
import {openDomainRecovery} from '../browser/domain-recovery';
import {retireClockReviews} from './clock-agent-review';
import { negotiateEnabledViews } from './device-view-profile';
import { workflowPresentationProtocol } from './workflow-presentation';
import {developmentIdentity,readDevelopmentIdentity,verifyDevelopmentIdentity,developmentOwnerRecovery,assertDevelopmentIdentity} from '../browser/development-identity';
import {developmentCloudKey} from '../browser/development-cloud';
import {DevelopmentCloudSetup} from '../browser/development-cloud-ui';
import {developmentCredential,developmentJournal,authorDevelopmentAction} from '../browser/development-actions';
import {browserDevProfile as devProfileQuery} from '../browser/dev-profile';
import {testMocksEnabled,devSurfacesEnabled} from '../build-flags';
import {developmentBridge,developmentName,developmentProfiles,developmentReply,saveDevelopmentReply,type DevelopmentProfile} from '../browser/development-connection';
import {Capacitor} from '@capacitor/core';
import {personalIntentDocument,type PersonalIntent} from './cloud-personal-intent';
import { CloudPersonalSetup, personalIntent, savePersonalIntent, clearPersonalIntent, type PersonalSetupState } from './cloud-personal-setup';
import { PersonalProtocolError, type CloudPersonalProtocol, type PersonalView, type PersonalOwner } from './cloud-personal-protocol';
import { holdPhoneInert } from './modal-inert';
import { pauseHostedBackground } from './hosted-background';
import {developmentDeviceStore,developmentActionJournal} from './local-agent-storage';
import { stopLocalAgent, configureLocalProvider, bindResidentCloudProvider, LocalAgentProtocol, localAgentPackaged, browserLocalAgentEnabled, localProviderStatus, clearLocalProvider, providerStatusLabel, LOCAL_PROVIDER_MODEL, type LocalProviderStatus } from './local-agent';
import { presentDeviceRecordOperation } from './device-record-presentation';
import type { MessagePage } from './remote-protocol';
import type {DeviceRecovery} from "./device-actions";
import type { WorkflowPhoneReview } from './workflow-device-contract';
import { AlphaClientError } from './alpha-client';
import { WorkflowProtocol, WorkflowHttpError } from './workflow-protocol';
import { registerPlugin } from '../platform-plugins';
import { DeviceActions, actionScope, type DeviceCredential, type DeviceExecutor, type ForegroundReviewExecutor, type ActionJournal } from './device-actions';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isAndroid } from '../native';
import type { ActionProposal, OperationReceipt, ContextEnvelope, VerifiedSession } from './alpha-client';
import { CloudProtocol, CloudProtocolError, type CloudAgent, type CloudEnvironment, type CloudPhoneTarget } from './cloud-protocol';
import { checkEntitlement, clearEntitlementKeyCache, describeSubscription, EntitlementError, EntitlementRefresher, isEntitlementSignInFailure, CHOOSE_PLAN_LABEL, MANAGE_PLAN_LABEL, planAdmission, readServiceLimit, redeemFailureMessage, redeemSuccessMessage, serviceLimitMessage, SubscriptionRedeemError, type SubscriptionView } from './subscription-entitlement';
import { RemoteProtocol, RemoteProtocolError } from './remote-protocol';
import { phoneContextMessage } from './phone-context';
import { cloudCredentialStore, remoteCredentialStore, nativeCloudRequest, nativeRemoteRequest, openConnectionBrowser, removeStoredCloudCredential, secureConnectionStore } from './native-connection';
import './connection-ui.css';

type Selection = {kind:'development';profile:DevelopmentProfile;account?:string} | { kind: 'resident' } | { kind: 'offline'; localApps?: true } | { kind: 'none' } | { kind: 'mock' } | { kind: 'remote' | 'local'; origin: string } | { kind: 'cloud'; environment: CloudEnvironment; agentId: string; ownerId?: string };
export interface CloudServiceSession { environment: CloudEnvironment; userId: string; organizationId?: string; sessionId: string; credentialId: string; email?: string;
  /** When this phone's Cloud sign-in key expires (from the CLI login), if Cloud reported it. */
  expiresAt?: number }
export interface RestoredMessage { id: string; from: 'user' | 'agent'; text: string }
export interface ConnectionSnapshot {
  /** Automatic session restoration has completed; null is now a resolved no-session state. */
  startupResolved?: boolean;
  /** Subscription plan state from a verified Cloud entitlement; never a credit balance. */
  residentSubscription?: SubscriptionView | null;
  residentSavedCredential?: boolean;
  /**
   * Production plan gate (owner decision, #410). 'needs-plan': signed in without an admissible
   * plan; the agent is not started and the gate offers Redeem code / Choose a plan. 'offline': a
   * plan verified recently on this phone keeps local apps available while Cloud is unreachable.
   */
  residentGate?: 'needs-plan' | 'offline' | null;
  /** When the current plan or redeemed grant ends, if Cloud reported it. */
  planEndsAt?: number | null;
  /** Outcome of the last subscription code submission. Never contains the code. */
  redeemNotice?: string; redeemError?: string;
  cloudPersonal?: PersonalSetupState;
  phoneActionsAvailable: boolean; phoneCapabilityReason: string;
  conversations: Array<{ id: string; title: string }>;
  history: { sessionId: string; conversationId: string; revision: number; messages: RestoredMessage[]; automatic: boolean } | null;
  historyError?: string;
  /** `description` is the one-line presentation; title/detail/timestamp are its parts. */
  actionHistory: Array<{ id: string; state: string; description: string; title: string; detail: string; outcome: string; timestamp: string }>;
  /** Native provider status shown in Settings; never contains the key. */
  providerStatus?: LocalProviderStatus | null;
  /** Shown after Stop when the agent may still finish; cleared by the single reconciliation. */
  replyNotice?: string;
  /** Older messages beyond the restored window remain on the agent. */
  historyPartial?: boolean;
  cloudAccount: CloudServiceSession | null;
  purpose?:'agent'|'cloud-account'|'plan';
  open: boolean; busy: boolean; message: string; error: string;
  kind: 'offline' | 'remote' | 'local' | 'resident' | 'cloud'; name: string;
  session: VerifiedSession | null; agents: CloudAgent[];
}
/** `revokeDevice` revokes this phone's enrollment on the agent; `deviceSlot` names its installation key. */
type Enrollment = { revokeDevice?: (signal: AbortSignal) => Promise<boolean>; deviceSlot?: string; deviceHeaders?: Record<string,string> };
type DeviceRequest=(path:string,body:unknown|undefined,signal:AbortSignal)=>Promise<unknown>;
type Active = ({ kind: 'resident'; remote: LocalAgentProtocol; origin: string; actions?: DeviceActions; workflowProtocol?: 1|2; userTextFormatVersion?:1 } | { kind: 'remote' | 'local'; remote: RemoteProtocol; origin: string; actions?: DeviceActions; workflowProtocol?: 1|2 } | { kind: 'cloud'; cloud: CloudProtocol; agentId: string; actions?: DeviceActions; workflowProtocol?: 1|2; phoneTarget?: CloudPhoneTarget; voiceExpiresAt?: number }) & Enrollment & { request?:DeviceRequest; viewNavigation?:ViewNavigationClient };
const SELECTION = 'alpha.connection.selection.v1';
// The development chooser exists only on an explicitly flagged development server.
const browserDevProfile = devSurfacesEnabled && devProfileQuery;
/** Production builds offer only the production Cloud environment. */
const cloudEnvironmentAllowed = (environment: unknown): environment is CloudEnvironment => environment === 'production' || (testMocksEnabled && environment === 'staging');
/** Every product build is local-agent-only; remote infrastructure is development-only. */
const remotePairingRetired = !testMocksEnabled;
/** Eliza Cloud admits no request from the production web origin, so no Cloud route is started there. */
const webCloudUnavailable = () => !testMocksEnabled && !isAndroid && !browserLocalAgentEnabled;
const CLOUD_SERVICE = 'alpha.connection.cloud-service.v1';
/**
 * Subscription gate QA (test-mocks builds only): runs the production sign-in and plan gate
 * against the chosen Cloud environment, including staging (docs/cloud-subscription-qa.md).
 */
const RESIDENT_QA = 'alpha.connection.resident-qa.v1';
function residentQa(): CloudEnvironment | null {
  if (!testMocksEnabled) return null;
  try { const value = localStorage.getItem(RESIDENT_QA); return value === 'production' || value === 'staging' ? value : null; } catch { return null; }
}
/** Production Android always runs the sign-in and plan gate; test-mocks builds only in QA mode. */
function residentGate(): boolean { return (isAndroid && !testMocksEnabled) || residentQa() !== null; }
function residentEnvironment(): CloudEnvironment { return residentQa() ?? 'production'; }
/** The on-device agent's Cloud inference binding is production-only (native reads cloud:production). */
function residentBindable(): boolean { return isAndroid && residentEnvironment() === 'production'; }
/** Warn this long before this phone's Cloud sign-in key expires (CLI keys last 90 days). */
export const CLOUD_KEY_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * A plan verified on this phone within this window keeps local apps available while Cloud is
 * unreachable. An engineering bound for offline use, not a billing decision: Cloud still
 * refuses every AI request without a plan.
 */
export const OFFLINE_PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_ADMISSION = 'alpha.connection.plan-admission.v1';
type PlanAdmissionRecord = { version: 1; environment: CloudEnvironment; credentialId: string; userId: string; organizationId: string | null; status: 'active' | 'trialing' | 'past_due'; planName: string; verifiedAt: number; endsAt: number | null };
function readPlanAdmission(): PlanAdmissionRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(PLAN_ADMISSION) || 'null');
    if (!value || value.version !== 1 || !cloudEnvironmentAllowed(value.environment) || typeof value.credentialId !== 'string' || typeof value.userId !== 'string' || !['active', 'trialing', 'past_due'].includes(value.status) || typeof value.planName !== 'string' || !Number.isFinite(value.verifiedAt)) return null;
    return { version: 1, environment: value.environment, credentialId: value.credentialId, userId: value.userId, organizationId: typeof value.organizationId === 'string' ? value.organizationId : null, status: value.status, planName: value.planName, verifiedAt: value.verifiedAt, endsAt: Number.isFinite(value.endsAt) ? value.endsAt : null };
  } catch { return null; }
}
function writePlanAdmission(record: PlanAdmissionRecord | null) { try { if (record) localStorage.setItem(PLAN_ADMISSION, JSON.stringify(record)); else localStorage.removeItem(PLAN_ADMISSION); } catch { /* Offline grace is a convenience; the gate still checks Cloud. */ } }
/** The recent admitting plan this credential holds, or null. */
function recentPlanAdmission(environment: CloudEnvironment, credentialId: string | undefined, userId?: string): PlanAdmissionRecord | null {
  const record = readPlanAdmission();
  if (!record || !credentialId || record.environment !== environment || record.credentialId !== credentialId || (userId !== undefined && record.userId.toLowerCase() !== userId.toLowerCase())) return null;
  const age = Date.now() - record.verifiedAt;
  return age >= 0 && age <= OFFLINE_PLAN_GRACE_MS ? record : null;
}
/** A Cloud outage or no network: not a refusal of the account or the plan. */
function cloudUnreachable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof CloudProtocolError) return error.code === 'http' && (error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500);
  if (error instanceof EntitlementError) return false;
  return error instanceof Error && /^(Connection request failed|Connection timed out|Request cancelled)$/.test(error.message);
}
const OFFLINE_NOTICE = 'Eliza Cloud cannot be reached right now. Local apps and on-device speech keep working with your recent plan; your agent starts when Cloud is reachable again, checked when the network returns or you come back to Alpha Phone.';
const listeners = new Set<() => void>();
let developmentPageSuspended = false;
let state: ConnectionSnapshot = { startupResolved:false, phoneActionsAvailable:false, phoneCapabilityReason:'', actionHistory: [], conversations: [], history: null, cloudAccount: null, open: false, busy: false, message: '', error: '', kind: 'offline', name: 'Offline', session: null, agents: [] };
let active: Active | null = null, operation: AbortController | null = null;
let startup: Promise<void> | null = null, epoch = 0;
let sending: AbortController | null = null;
let developmentVoiceExpiresAt=0;
const automationsRequests = new Set<AbortController>();
const conversationMemory = new Map<string, string>();
const actionReceipts = new Map<string, { sessionId: string; result: Promise<OperationReceipt> }>();
const readReplyOwners=new Map<ReadReplyBinding,{actions:DeviceActions;proposalId:string;digest:string;cancelled:boolean}>();
function retireReadReplies(){for(const binding of [...readReplyOwners.keys()])void connectionController.cancelReadReply(binding).catch(()=>{});}
let navigationContext:(()=>ContextEnvelope|null)|undefined;
let deviceRecovery: DeviceRecovery | undefined;
let deviceExecutor: DeviceExecutor = async () => ({ status: 'failed', summary: 'Device action executor is unavailable.' });
/** Foreground local reviews (free/busy over owner-chosen calendars). The phone shell supplies the
 * executor; a restored connection may negotiate first, so a missing executor fails closed. */
let foregroundExecutor: ForegroundReviewExecutor | undefined;
const runForegroundReview: ForegroundReviewExecutor = (op, id, context, signal, bindingHash, journalIdentity) => foregroundExecutor ? foregroundExecutor(op, id, context, signal, bindingHash, journalIdentity) : Promise.resolve({ status: 'failed', summary: 'This review is unavailable on this phone. Nothing was shared.' });
/** The shared contract's free/busy capability name (kept equal by test-calendar-availability-flow). */
export const CALENDAR_AVAILABILITY_CAPABILITY = 'calendar.availability-read.v1';
/** Free/busy is negotiated only when the agent offers it. */
const availabilityNegotiated = (offered: unknown) => Array.isArray(offered) && offered.includes(CALENDAR_AVAILABILITY_CAPABILITY);
let deviceReadReview:((proposal:ActionProposal,context:ContextEnvelope,signal:AbortSignal)=>Promise<void>)|undefined;
const actionJournal = registerPlugin<ActionJournal>('AlphaActionJournal');
let cloud = makeCloud('production');
let service: { client: CloudProtocol; identity: CloudServiceSession } | null = null;
let entitlementRefresher: EntitlementRefresher | null = null;
/** Every Cloud detach ends background plan refresh, so no request goes out under a stale admission. */
function stopEntitlementRefresh(){entitlementRefresher?.stop();entitlementRefresher=null;clearEntitlementKeyCache();}
function detachService() { stopEntitlementRefresh(); retireReadReplies();for(const request of automationsRequests)request.abort(new DOMException('Cloud account changed','AbortError')); clearPersonalSetup(); service = null; update({ cloudAccount: null }); }
async function verifyService(client: CloudProtocol, signal: AbortSignal, expected?:{credentialId:string;credentialReference?:string}) {
  const credential = await cloudCredentialStore.read(client.environment); signal.throwIfAborted();
  if(expected&&(credential?.credentialId!==expected.credentialId||credential?.credentialReference!==expected.credentialReference))throw new Error('Cloud account changed. Try again.');
  if(residentGate())update({residentSavedCredential:!!credential?.credentialId});
  if (!credential?.credentialId) throw new Error('Cloud credentials are unavailable. Sign in again.');
  const identity = await client.identity(signal); signal.throwIfAborted();
  const current=await cloudCredentialStore.read(client.environment);
  if (current?.credentialId !== credential.credentialId || expected&&current?.credentialReference!==expected.credentialReference) throw new Error('Cloud account changed. Try again.');
  signal.throwIfAborted();
  const same = service?.identity.environment === client.environment && service.identity.userId === identity.userId && service.identity.organizationId === identity.organizationId && service.identity.credentialId === credential.credentialId;
  const account = { ...identity, credentialId: credential.credentialId, environment: client.environment, sessionId: same ? service!.identity.sessionId : crypto.randomUUID(), ...(Number.isFinite(credential.expiresAt) ? { expiresAt: credential.expiresAt } : {}) };
  localStorage.setItem(CLOUD_SERVICE, client.environment);
  service = { client, identity: account }; update({ cloudAccount: account });
  return identity;
}
let personalSetup: { client:CloudPersonalProtocol; serviceId:string } | null = null;
let personalGeneration=0;
let personalRecovery:AbortController|null=null;
function clearPersonalSetup(){personalRecovery?.abort();personalGeneration++;personalSetup=null;update({cloudPersonal:undefined});}
function personalCurrent(binding:NonNullable<typeof personalSetup>,generation:number){return generation===personalGeneration&&personalSetup===binding&&service?.identity.sessionId===binding.serviceId&&service.identity.credentialId===binding.client.owner.credentialId&&service.identity.environment===binding.client.owner.environment&&service.identity.userId===binding.client.owner.userId&&service.identity.organizationId===binding.client.owner.organizationId;}
async function inspectPersonal(signal:AbortSignal){
 if(!testMocksEnabled)throw Error(PAIRING_RETIRED);
 const generation=personalGeneration,serviceId=service?.identity.sessionId;
 if(!serviceId)throw Error('Sign in with Eliza Cloud first.');
 const client=await cloud.personal(signal);signal.throwIfAborted();
 if(generation!==personalGeneration||service?.identity.sessionId!==serviceId||service.identity.credentialId!==client.owner.credentialId||service.identity.userId!==client.owner.userId||service.identity.organizationId!==client.owner.organizationId)throw Error('Cloud account changed. Refresh status.');
 const binding={client,serviceId};personalSetup=binding;
 try{const expected=await personalIntent(client.owner,signal);
 const view=await client.inspect(signal);signal.throwIfAborted();
 if(!personalCurrent(binding,generation))return;
 await publishPersonal(binding,view,expected,generation,signal);
 }catch(error){if(personalCurrent(binding,generation))update({cloudPersonal:{view:null,blocked:true,declined:false}});throw error;}
}
async function publishPersonal(binding:NonNullable<typeof personalSetup>,view:PersonalView,expected:PersonalIntent|null,generation:number,signal:AbortSignal){
 const current=()=>{signal.throwIfAborted();if(!personalCurrent(binding,generation))throw Error('Cloud account changed. Refresh status.');};current();
 let intent=await personalIntent(binding.client.owner,signal);current();
 if(JSON.stringify(intent)!==JSON.stringify(expected))throw Error('Cloud setup changed in another view. Refresh its status.');
 if(intent?.phase==='activation'&&intent.state==='accepted'&&(view.kind==='review'||view.kind==='unavailable')&&intent.personalElizaId===view.review.personalElizaId&&intent.dedicatedAgentId&&intent.dedicatedAgentId===view.review.dedicatedAgentId&&['stopped','sleeping','error'].includes(view.review.status||'')){await clearPersonalIntent(binding.client.owner,intent,signal);intent=null;current();}
 if(intent&&view.kind==='ready'){
  if(intent.personalElizaId!==view.identity.personalElizaId||(intent.dedicatedAgentId&&intent.dedicatedAgentId!==view.identity.activeAgentId))throw Error('Cloud setup returned a different target. Review the account before connecting.');
  await clearPersonalIntent(binding.client.owner,intent,signal);intent=null;current();
 }
 const blocked=!!intent&&view.kind!=='ready'&&(view.kind!=='pending'||intent.phase==='cutover'||intent.personalElizaId!==view.receipt.personalElizaId||(!!intent.dedicatedAgentId&&intent.dedicatedAgentId!==view.receipt.dedicatedAgentId));
 update({cloudPersonal:{view,blocked,declined:false},message:view.kind==='ready'?'Your personal Cloud agent is ready.':view.kind==='pending'?'Setup accepted. Check status to continue.':'Cloud account connected. Review Dedicated hosting before starting setup.',error:''});
}
async function personalDispatch(binding:NonNullable<typeof personalSetup>,generation:number,intent:PersonalIntent,signal:AbortSignal){
 if(!signal.aborted&&personalCurrent(binding,generation))return;
 await clearPersonalIntent(binding.client.owner,intent);signal.throwIfAborted();throw Error('Cloud account changed before setup was sent.');
}
async function personalWork(message:string,action:(binding:NonNullable<typeof personalSetup>,view:PersonalView,signal:AbortSignal)=>Promise<void>){
 if(!testMocksEnabled){update({error:PAIRING_RETIRED});return;}
 await work(message,async signal=>{
  const binding=personalSetup,view=state.cloudPersonal?.view,generation=personalGeneration;
  if(!binding||!view||!personalCurrent(binding,generation))throw Error('Refresh Cloud status before continuing.');
  try{await action(binding,view,signal);}
  catch(error){
   if(!personalCurrent(binding,generation))return;
   // Expiration detaches this exact service, without clearing durable setup intent.
   if((error instanceof CloudProtocolError||error instanceof PersonalProtocolError)&&expired(error)&&connectionController.rejectCloudSession(binding.serviceId,error))return;
   let blocked=true;try{blocked=!!await personalIntent(binding.client.owner);}catch{/* Invalid persistence refuses further setup writes. */}
   if(!personalCurrent(binding,generation))return;
   if(signal.aborted&&!blocked){update({cloudPersonal:undefined,message:'Cloud setup check stopped.',error:''});personalGeneration++;personalSetup=null;return;}
   update({cloudPersonal:{view:state.cloudPersonal?state.cloudPersonal.view:view,blocked,declined:false},message:blocked?'Setup could not be confirmed. Check status before taking another action.':'',error:blocked?'':error instanceof PersonalProtocolError&&error.code==='account-changed'?'Cloud account changed. Refresh status.':'Cloud setup is unavailable. Refresh status to review the current state.'});
  }
 });
}
function detachCloudTarget() { if (active?.kind === 'cloud') retire(); }
// Only the Android transport admits Cloud's self-revocation DELETE; elsewhere sign-out reports a local removal.
function makeCloud(environment: CloudEnvironment) { return new CloudProtocol(environment, nativeCloudRequest, cloudCredentialStore, openConnectionBrowser, { deleteRequests: isAndroid }); }
function update(patch: Partial<ConnectionSnapshot>) { state = { ...state, ...patch }; if (!developmentPageSuspended) listeners.forEach(listener => listener()); }
function save(selection: Selection) { localStorage.setItem(SELECTION, JSON.stringify(selection)); }
function retire(name = 'Offline') {
  retireReadReplies();
  const retirement=Promise.allSettled([state.session?pauseHostedBackground(state.session.sessionId):Promise.resolve(),retireClockReviews()]).then(results=>{const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;});
  void retirement.catch(()=>update({error:'Background delivery could not be retired. Reconnect to reset it.'}));
  if (active?.kind === 'cloud') { active.cloud.setPhoneTarget(null); if (state.session) void secureConnectionStore.remove(`cloud-runtime:${state.session.sessionId}`).catch(()=>{}); }
  active?.viewNavigation?.dispose();
  actionReceipts.clear();
  conversationMemory.clear();
  cancelStoppedReply();
  for(const request of automationsRequests)request.abort(new DOMException('The connection changed','AbortError'));
  epoch++;
  sending?.abort(new DOMException('The connection changed.', 'AbortError'));
  sending = null;
  active = null;
  update({ phoneActionsAvailable:false, phoneCapabilityReason:'', session: null, kind: 'offline', name, conversations: [], history: null, historyError:'', historyPartial:false, replyNotice:'', actionHistory: [] });
  return retirement;
}
function persistOffline(): string {
  try { save({ kind: 'offline' }); return ''; }
  catch {
    try { localStorage.removeItem(SELECTION); } catch { /* The visible error explains restart uncertainty. */ }
    return 'Offline now, but this preference could not be saved. Check the connection again after restarting the app.';
  }
}
function expired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('status' in error && error.status === 401) || ('code' in error && ['expired', 'credentials-missing', 'session_expired', 'not_connected'].includes(String(error.code)));
}
function localAppsSelected(): boolean { const saved = selection(); return saved?.kind === 'offline' && saved.localApps === true; }
function selection(): Selection | null {
  try {
    const value = JSON.parse(localStorage.getItem(SELECTION) || 'null');
    if(browserDevProfile&&value?.kind==='development'&&developmentProfiles.includes(value.profile))return value;
    if (value?.kind === 'offline') return value.localApps === true ? { kind: 'offline', localApps: true } : { kind: 'offline' };
    if (value?.kind === 'resident' || value?.kind === 'none') return value;
    if (testMocksEnabled && value?.kind === 'mock') return value;
    if (value?.kind === 'remote' && typeof value.origin === 'string') return value;
    if (testMocksEnabled && value?.kind === 'local' && typeof value.origin === 'string') return value;
    if (value?.kind === 'cloud' && cloudEnvironmentAllowed(value.environment) && typeof value.agentId === 'string') return value;
  } catch { /* Invalid nonsecret preferences do not authenticate a connection. */ }
  return null;
}
function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'expired') return 'This sign-in link has expired. Close the old browser tab and select Sign in with Eliza Cloud to open a fresh link.';
    if (error.code === 'credential-consumed') return 'This sign-in link has already been used. Close the old browser tab and start a fresh Eliza Cloud sign-in.';
    if (error.code === 'credentials-missing') return 'Sign in with Eliza Cloud to reconnect your account.';
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'Connection cancelled.';
  if (error instanceof EntitlementError && error.code === 'account-mismatch') return 'Eliza Cloud returned plan status for a different account. Sign in again.';
  if (error && typeof error === 'object' && 'status' in error && error.status === 401) return testMocksEnabled?'Your session has expired. Sign in or pair again.':'Your session has expired. Sign in again.';
  if (error && typeof error === 'object' && 'status' in error && error.status === 503) return 'The agent is starting or temporarily unavailable. Try again shortly.';
  return error instanceof Error ? error.message : 'The connection could not be completed.';
}
async function work(message: string, action: (signal: AbortSignal) => Promise<void>) {
  if (operation) return;
  const controller = new AbortController(); operation = controller;
  update({ busy: true, open: true, message, error: '' });
  try { await action(controller.signal); }
  catch (error) {
    if(controller.signal.aborted&&!state.open){update({error:'',message:''});return;}
    if (expired(error) && active?.kind === 'cloud' && active.cloud.environment === cloud.environment) {
      const previous = active; retire('Sign-in required'); detachService();
      try { await previous.cloud.disconnect(); }
      catch { update({ error: 'The expired connection is detached, but its stored credential could not be removed.', open: true, message: '' }); return; }
    }
    update({ error: errorMessage(error), open: true, message: '' });
  }
  finally { if (operation === controller) operation = null; update({ busy: false }); }
}
function activate(next: Active, session: VerifiedSession, name: string) {
  retireReadReplies();
  active?.viewNavigation?.dispose();
  actionReceipts.clear();
  conversationMemory.clear();
  cancelStoppedReply();
  for(const request of automationsRequests)request.abort(new DOMException('The connection changed','AbortError'));
  epoch++; sending?.abort(new DOMException('The connection changed.', 'AbortError')); sending = null; active = next;
  update({ phoneActionsAvailable:!!next.actions, conversations: [], history: null, historyError: '', historyPartial:false, replyNotice:'', actionHistory: [], kind: next.kind, name, session, open: false, message: 'Connected', error: '' });
}
async function remoteIdentity(remote: RemoteProtocol, signal: AbortSignal) {
  const credential = await remoteCredentialStore.read(remote.origin);
  if (!credential || !remote.session) throw new Error('Pair this agent before connecting.');
  const response = await nativeRemoteRequest({ url: remote.origin + '/api/agents', method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential.token}` }, signal });
  if (response.status !== 200) {
    if (response.status === 401) await remote.disconnect();
    throw new Error('The agent identity could not be verified. Pair again if its session was revoked.');
  }
  const agents = (response.body as { agents?: unknown })?.agents;
  if (!Array.isArray(agents) || agents.length !== 1) throw new Error('Choose an endpoint serving one agent.');
  const agent = agents[0];
  if (typeof agent?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(agent.id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(agent.id)) throw new Error('The agent has not published a valid identity.');
  if (agent.status !== 'running') throw new Error('The agent is not running yet. Try again when it is ready.');
  return { id: agent.id, name: typeof agent.name === 'string' ? agent.name : 'Remote agent' };
}
async function connectRemote(kind: 'remote' | 'local', origin: string, code: string, signal: AbortSignal) {
  // Fences every caller, including restore: no request is made and the saved credential is kept.
  if (remotePairingRetired) throw new Error(PAIRING_RETIRED);
  let deviceHeaders: Record<string, string> = {};
  const remote = new RemoteProtocol(origin.trim(), input => nativeRemoteRequest({ ...input, headers: { ...input.headers, ...deviceHeaders } }), remoteCredentialStore, { developmentOrigins: kind === 'local' ? [new URL(origin).origin] : [] });
  if (code.trim()) await remote.pair(code.trim(), signal);
  else if (!await remote.restore(signal)) throw new Error('Enter the pairing code displayed by your agent.');
  const agent = await remoteIdentity(remote, signal); signal.throwIfAborted();
  const verified = remote.session!;
  const session = { ownerId: verified.identityId, agentId: agent.id, sessionId: crypto.randomUUID(), origin: remote.origin };
  let actions: DeviceActions | undefined;
  let deviceRequest:DeviceRequest|undefined;
  let reason = "";
  const enrollment: Enrollment = {};
  const workflowProtocol=await workflowPresentationProtocol(signal);
  try {
    const baseScope = await actionScope(JSON.stringify([remote.origin, session.ownerId, session.agentId]));
    const slot = `device:${baseScope}`;
    enrollment.deviceSlot = slot;
    let credential = await secureConnectionStore.read<DeviceCredential>(slot);
    if (!credential) {
      credential = { installationId: crypto.randomUUID(), key: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') };
      await secureConnectionStore.write(slot, credential);
    }
    if (!/^[a-f0-9]{64}$/.test(credential.key) || !/^[a-f0-9-]{36}$/.test(credential.installationId)) throw new Error('Invalid saved device identity');
    const headers = { 'X-Eliza-Device-Id': credential.installationId, 'X-Eliza-Device-Key': credential.key, 'X-Eliza-Device-Capabilities': 'calendar.local-event.v1,notes.local-record.v1' };
    const request = async (path: string, body: unknown | undefined, requestSignal: AbortSignal) => {
      requestSignal.throwIfAborted();
      const auth = await remoteCredentialStore.read(remote.origin);
      if (!auth || auth.identityId !== session.ownerId || !remote.session || auth.expiresAt <= Date.now()) throw new Error('Device session changed');
      const response = await nativeRemoteRequest({ url: remote.origin + path, method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: requestSignal });
      if (response.status < 200 || response.status >= 300) throw Object.assign(new Error('Device action request failed'), { status: response.status });
      return response.body;
    };
    const registered = await request('/api/client-devices/register', { label: 'Alpha Phone', workflowProtocol }, signal) as { installationId: string; enrollmentId: string; capabilities?: string[]; viewProfileVersion?: unknown };
    if (registered.installationId !== credential.installationId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId)) throw new Error('Device registration was not verified');
    reason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes("reminders.local-record.v2"))headers["X-Eliza-Device-Capabilities"]+=",reminders.local-record.v2";else if(Array.isArray(registered.capabilities)&&registered.capabilities.includes("reminders.local-record.v1"))headers["X-Eliza-Device-Capabilities"]+=",reminders.local-record.v1";
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes('notes.query.v1'))headers['X-Eliza-Device-Capabilities']+=',notes.query.v1';
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes('reminders.create.v1'))headers['X-Eliza-Device-Capabilities']+=',reminders.create.v1';
    if(Capacitor.getPlatform()==='android')for(const capability of ['calendar.create.v1','calendar.next-read.v1'])if(registered.capabilities?.includes(capability))headers['X-Eliza-Device-Capabilities']+=','+capability;
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes("maps.selected-read.v1"))headers["X-Eliza-Device-Capabilities"]+=",maps.selected-read.v1";
    if(availabilityNegotiated(registered.capabilities))headers["X-Eliza-Device-Capabilities"]+=","+CALENDAR_AVAILABILITY_CAPABILITY;
    if(Capacitor.getPlatform()==='android'&&registered.capabilities?.includes("clock.handoff.v1"))headers["X-Eliza-Device-Capabilities"]+=",clock.handoff.v1";
    credential.enrollmentId = registered.enrollmentId;
    await secureConnectionStore.write(slot, credential); signal.throwIfAborted();
    deviceHeaders = headers;
    enrollment.deviceHeaders = headers;
    credential.capabilities=headers["X-Eliza-Device-Capabilities"].split(",");
    actions = new DeviceActions(session, credential, await actionScope(JSON.stringify([baseScope, credential.installationId])), request, actionJournal, (op, id, context, effectSignal, bindingHash, workflowRoute, journalIdentity) => deviceExecutor(op, id, context, effectSignal, bindingHash, workflowRoute, journalIdentity),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:"unknown"}),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    deviceRequest=request;
  } catch { signal.throwIfAborted(); reason = "Chat connected. Phone action enrollment was not confirmed. Reconnect to review its status."; }
  save({ kind, origin: remote.origin });
  activate({ kind, remote, origin: remote.origin, actions, workflowProtocol, ...enrollment, request:deviceRequest }, session, agent.name);
  if (reason) update({phoneCapabilityReason: reason});
  await restoreSavedHistory(signal);

}
async function connectDevelopment(profile:DevelopmentProfile,signal:AbortSignal){
 if(!browserDevProfile)throw Error('Development mode required.');
 // This explicitly gated browser fixture implements reminder v2; real peers still negotiate it.
 const identity=await readDevelopmentIdentity(profile,signal);const client=new LocalAgentProtocol(developmentBridge(profile,identity));const {session,name}=await client.connect(signal);signal.throwIfAborted();const credential=developmentCredential(profile,identity),scope=await actionScope(JSON.stringify([client.origin,session.ownerId,session.agentId,credential.installationId]));const actions=new DeviceActions(session,credential,scope,(path,body,signal)=>client.request(path,body,signal),developmentJournal(profile,identity),(op,id,context,signal,binding,workflowRoute,journalIdentity)=>deviceExecutor(op,id,context,signal,binding,workflowRoute,journalIdentity),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:'unknown'}),true,true);await retire();signal.throwIfAborted();await verifyDevelopmentIdentity(identity,signal);const workflowProtocol=2 as const;save({kind:'development',profile,...(identity.account?{account:identity.account}:{})});developmentVoiceExpiresAt=Date.now()+3600000;activate({kind:'resident',remote:client,origin:client.origin,actions,workflowProtocol},session,name);
}
async function admitCloudResident(signal:AbortSignal):Promise<boolean> {
  stopEntitlementRefresh();
  update({residentSubscription:{kind:'checking'},redeemError:''});
  const environment=residentEnvironment();
  cloud = makeCloud(environment);
  const client=cloud;
  const saved=await cloudCredentialStore.read(environment);signal.throwIfAborted();
  let identity:Awaited<ReturnType<typeof verifyService>>;
  try{identity=await verifyService(client,signal);}
  catch(error){
    signal.throwIfAborted();
    // Offline or a Cloud outage: a plan verified recently on this phone keeps local apps available.
    // Nothing is started: the agent's AI and its Cloud binding need Cloud.
    const recent=cloudUnreachable(error)?recentPlanAdmission(environment,saved?.credentialId):null;
    if(!recent)throw error;
    update({residentGate:'offline',residentSubscription:{kind:'unavailable',reason:'outage'},planEndsAt:recent.endsAt,open:true,message:OFFLINE_NOTICE,error:''});
    return false;
  }
  const account=service;
  if(!account)throw Error('Cloud account changed. Sign in again.');
  // One entitlement read at admission; turns never wait on billing.
  const expected={userId:identity.userId,organizationId:identity.organizationId??null};
  const checked=await checkEntitlement(client.entitlementSource(),expected,signal);
  signal.throwIfAborted();
  if(service!==account || (await cloudCredentialStore.read(environment))?.credentialId!==account.identity.credentialId)throw Error('Cloud account changed. Sign in again.');
  let view=checked.view,decision=planAdmission(view);
  const recent=recentPlanAdmission(environment,account.identity.credentialId,account.identity.userId);
  // A billing outage after a recent verified plan keeps the agent: Cloud still decides each AI request.
  if(decision==='unknown'&&view.kind==='unavailable'&&view.reason==='outage'&&recent)decision=recent.status==='past_due'?'admit-with-warning':'admit';
  // End of the plan window when Cloud reported one: the billing snapshot's period end, a redeemed grant's end, or the last known.
  const endsAt=view.kind==='active'&&view.source==='billing-limits'&&view.expiresAt>0?view.expiresAt:recent?.endsAt??(state.cloudAccount?.credentialId===account.identity.credentialId?state.planEndsAt??null:null);
  if(decision==='needs-plan'||decision==='unknown'){
    // The plan gate: no agent start, no provider binding. Redeem code / Choose a plan / Check again.
    if(decision==='needs-plan')writePlanAdmission(null);
    if(active?.kind==='resident'){try{if(isAndroid)await stopLocalAgent();}catch{/* The gate below still applies. */}retire('Plan required');}
    update({residentSubscription:view,residentGate:'needs-plan',planEndsAt:null,open:true,message:''});
    return false;
  }
  if(view.kind==='active')writePlanAdmission({version:1,environment,credentialId:account.identity.credentialId,userId:account.identity.userId,organizationId:account.identity.organizationId??null,status:view.status,planName:view.planName,verifiedAt:Date.now(),endsAt});
  update({residentSubscription:view,residentGate:null,planEndsAt:endsAt});
  // An admitted running resident under this same Cloud admission is reused, not stopped and rebound:
  // opening the assistant, or reconnecting one surface, must not retire the other surface's work.
  if(residentBindable()){
    await bindResidentCloudProvider(account.identity.credentialId);
    signal.throwIfAborted();
    if(service!==account || (await cloudCredentialStore.read(environment))?.credentialId!==account.identity.credentialId)throw Error('Cloud account changed. Sign in again.');
  }
  // Background refresh: it updates what the owner sees, never interrupts a turn, and applies the
  // plan gate again when Cloud reports the plan ended. Revocation is enforced by Cloud immediately.
  entitlementRefresher=new EntitlementRefresher({entitlement:checked.entitlement,fallbackActive:checked.view.kind==='active'&&checked.view.source==='billing-limits',retry:checked.view.kind==='unavailable'&&checked.view.reason!=='not-published',
    check:refreshSignal=>checkEntitlement(client.entitlementSource(),expected,refreshSignal),
    onView:next=>{if(service!==account)return;update({residentSubscription:next});
      const nextDecision=planAdmission(next);
      if(next.kind==='active')writePlanAdmission({version:1,environment,credentialId:account.identity.credentialId,userId:account.identity.userId,organizationId:account.identity.organizationId??null,status:next.status,planName:next.planName,verifiedAt:Date.now(),endsAt:state.planEndsAt??null});
      if(nextDecision==='needs-plan')void residentPlanEnded(account,next);},
    onAuthFailure:error=>{if(service===account)void residentRefreshRefused(account,error);}});
  return true;
}
/** Cloud reported, on a background refresh, that the plan ended: apply the plan gate. */
async function residentPlanEnded(account:NonNullable<typeof service>,view:SubscriptionView){
  stopEntitlementRefresh();writePlanAdmission(null);
  if(active?.kind==='resident'){try{if(isAndroid)await stopLocalAgent();}catch{/* The gate below still applies. */}}
  if(service!==account)return;
  if(active?.kind==='resident')retire('Plan required');
  update({residentSubscription:view,residentGate:'needs-plan',planEndsAt:null,open:true,purpose:'agent',message:'',error:''});
}

/**
 * A background refresh found the admitted account is no longer valid: a rejected sign-in, or an
 * entitlement issued for a different account. The same rule as admission applies: the Cloud-bound
 * agent is stopped and the owner is asked to sign in again. Anything else stays an outage view.
 */
async function residentRefreshRefused(account:NonNullable<typeof service>,error:unknown){
  if(!isEntitlementSignInFailure(error)){update({residentSubscription:{kind:'unavailable',reason:'outage'}});return;}
  stopEntitlementRefresh();
  try{if(isAndroid)await stopLocalAgent();}catch{/* The sign-in message below still applies. */}
  if(service!==account)return;
  if(active?.kind==='resident')retire('Sign-in required');
  detachService();
  update({residentSubscription:null,open:true,message:'',error:errorMessage(error)});
}
async function connectResident(signal: AbortSignal) {
  if(residentGate()){
    if(!await admitCloudResident(signal))return;
    // QA on staging (or in a browser) stops at plan admission: the on-device agent's Cloud
    // inference binding is production-only, so nothing is started under another environment.
    if(testMocksEnabled&&!residentBindable()){update({open:true,message:`Plan admitted on ${residentEnvironment()} (subscription gate QA). The on-device agent is not started in this mode.`,error:''});return;}
  }
  if (!await localAgentPackaged()) throw new Error(remotePairingRetired ? 'The on-device agent is not included in this build.' : webCloudUnavailable() ? 'The local agent is unavailable here. Connect a remote agent or continue offline.' : 'The local agent is unavailable here. Connect a remote agent, sign in with Eliza Cloud, or continue offline.');
  signal.throwIfAborted();
  const client = new LocalAgentProtocol();
  const { session, name } = await client.connect(signal);
  signal.throwIfAborted();
  let actions:DeviceActions|undefined;
  let deviceRequest:DeviceRequest|undefined;
  const workflowProtocol=await workflowPresentationProtocol(signal);
  let userTextFormatVersion:1|undefined;
  let reason='';
  try {
    const store=isAndroid?secureConnectionStore:developmentDeviceStore;
    const journal=isAndroid?actionJournal:developmentActionJournal;
    const baseScope=await actionScope(JSON.stringify([client.origin,session.ownerId,session.agentId]));
    const slot=`device:${baseScope}`;
    let credential=await store.read<DeviceCredential>(slot);
    if(!credential){credential={installationId:crypto.randomUUID(),key:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')};await store.write(slot,credential);}
    if(!/^[a-f0-9]{64}$/.test(credential.key)||!/^[a-f0-9-]{36}$/.test(credential.installationId))throw Error('Invalid device identity');
    // Browser and Android use the same reviewed local-record contracts.
    const headers={'X-Eliza-Device-Id':credential.installationId,'X-Eliza-Device-Key':credential.key,'X-Eliza-Device-Capabilities':'calendar.local-event.v1,notes.local-record.v1'};
    const request=(path:string,body:unknown|undefined,requestSignal:AbortSignal)=>client.request(path,body,requestSignal,headers);
    const registered=await request('/api/client-devices/register',{label:isAndroid?'Alpha Phone':'Alpha browser development',workflowProtocol},signal);
    if(registered.installationId!==credential.installationId||typeof registered.enrollmentId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId))throw Error('Device registration was not verified');
    if(registered.userTextFormatVersion===1)userTextFormatVersion=1;
    reason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes('reminders.local-record.v2'))headers['X-Eliza-Device-Capabilities']+=',reminders.local-record.v2';else if(Array.isArray(registered.capabilities)&&registered.capabilities.includes('reminders.local-record.v1'))headers['X-Eliza-Device-Capabilities']+=',reminders.local-record.v1';
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes('notes.query.v1'))headers['X-Eliza-Device-Capabilities']+=',notes.query.v1';
    if(Array.isArray(registered.capabilities)&&registered.capabilities.includes('reminders.create.v1'))headers['X-Eliza-Device-Capabilities']+=',reminders.create.v1';
    if(Capacitor.getPlatform()==='android')for(const capability of ['calendar.create.v1','calendar.next-read.v1'])if(registered.capabilities?.includes(capability))headers['X-Eliza-Device-Capabilities']+=','+capability;
    if(registered.capabilities?.includes('maps.selected-read.v1'))headers['X-Eliza-Device-Capabilities']+=',maps.selected-read.v1';
    if(availabilityNegotiated(registered.capabilities))headers['X-Eliza-Device-Capabilities']+=','+CALENDAR_AVAILABILITY_CAPABILITY;
    if(Capacitor.getPlatform()==='android'&&registered.capabilities?.includes("clock.handoff.v1"))headers["X-Eliza-Device-Capabilities"]+=",clock.handoff.v1";
    credential.enrollmentId=registered.enrollmentId;await store.write(slot,credential);signal.throwIfAborted();
    client.deviceHeaders=headers;
    credential.capabilities=headers["X-Eliza-Device-Capabilities"].split(",");
    actions=new DeviceActions(session,credential,await actionScope(JSON.stringify([baseScope,credential.installationId])),request,journal,(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity)=>deviceExecutor(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity),(op,id,binding,recoverySignal)=>deviceRecovery?deviceRecovery(op,id,binding,recoverySignal):Promise.resolve({status:'unknown'}),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    deviceRequest=request;
  } catch(error) {signal.throwIfAborted();reason='Local chat connected. Device actions are unavailable: '+(error instanceof Error?error.message:'Enrollment failed.');}
  save({kind:'resident'});
  activate({kind:'resident',remote:client,origin:client.origin,actions,workflowProtocol,request:deviceRequest,...(userTextFormatVersion?{userTextFormatVersion}:{})},session,name);
  if(reason)update({phoneCapabilityReason:reason});
  // Browser development keeps its explicit restore flow; Android restores the saved conversation.
  if(residentGate()){await restoreSavedHistory(signal);await refreshActionReview(signal);}
}
async function connectCloud(agentId: string, signal: AbortSignal, expectedOwner?: string, expectedOrigin?:string, expectedPersonalOwner?:Readonly<PersonalOwner>) {
  if(!testMocksEnabled)throw Error(PAIRING_RETIRED);
  const client=cloud;
  client.setPhoneTarget(null);
  const identity = await verifyService(cloud, signal); signal.throwIfAborted();
  const verifyPersonalOwner=async()=>{
    if(!expectedPersonalOwner)return;
    const credential=await cloudCredentialStore.read(client.environment);signal.throwIfAborted();
    if(cloud!==client||client.environment!==expectedPersonalOwner.environment||credential?.credentialId!==expectedPersonalOwner.credentialId||identity.userId!==expectedPersonalOwner.userId||identity.organizationId!==expectedPersonalOwner.organizationId||service?.identity.credentialId!==expectedPersonalOwner.credentialId||service.identity.userId!==expectedPersonalOwner.userId||service.identity.organizationId!==expectedPersonalOwner.organizationId)throw Error('Cloud account changed. Refresh your personal agent before connecting.');
  };
  await verifyPersonalOwner();
  if (expectedOwner && identity.userId !== expectedOwner) throw new Error('The Cloud account has changed. Refresh agents and choose an agent for this account.');
  const agent = await cloud.agentDetail(agentId, signal);
  await verifyPersonalOwner();
  if (agent.status !== 'running' || !agent.runtimeUrl) throw new Error('This agent is not ready. Refresh its status.');
  if(expectedOrigin&&new URL(agent.runtimeUrl).origin!==new URL(expectedOrigin).origin)throw Error('The personal Cloud runtime changed. Refresh its status.');
  const session = {ownerId:identity.userId,agentId,sessionId:crypto.randomUUID(),origin:new URL(agent.runtimeUrl).origin};
  const workflowProtocol=await workflowPresentationProtocol(signal);
  const next: Extract<Active,{kind:'cloud'}> = {kind:'cloud',cloud,agentId,workflowProtocol};
  let attached = false;
  let reason = 'This Cloud runtime has not enabled verified phone actions, workflows or paired speech.';
  try {
    const auth = await cloudCredentialStore.read(cloud.environment);
    await verifyPersonalOwner();
    if (!auth?.credentialId || !identity.organizationId) throw new Error('Cloud owner configuration unavailable');
    const baseScope = await actionScope(JSON.stringify(['cloud',session.origin,identity.userId,agentId]));
    const slot = `device:${baseScope}`;
    next.deviceSlot = slot;
    let credential = await secureConnectionStore.read<DeviceCredential>(slot);
    if (!credential) { credential={installationId:crypto.randomUUID(),key:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}; await secureConnectionStore.write(slot,credential); }
    if (!/^[a-f0-9]{64}$/.test(credential.key) || !/^[a-f0-9-]{36}$/.test(credential.installationId)) throw new Error('Invalid saved device identity');
    const target: CloudPhoneTarget = {agentId,origin:session.origin,userId:identity.userId,organizationId:identity.organizationId,credentialId:auth.credentialId,headers:{'X-Eliza-Device-Id':credential.installationId,'X-Eliza-Device-Key':credential.key,'X-Eliza-Device-Capabilities':'calendar.local-event.v1,notes.local-record.v1'}};
    const request = async (path:string,body:unknown|undefined,requestSignal:AbortSignal) => {
      if(attached && state.session?.sessionId!==session.sessionId)throw new Error('Cloud agent changed');
      const result=await client.phoneRequest(target,path,requestSignal,body);
      if(attached && state.session?.sessionId!==session.sessionId)throw new Error('Cloud agent changed');
      return result;
    };
    const capability = await request('/api/client-devices/capabilities',undefined,signal);
    const external=capability.externalIdentity as Record<string,unknown>|undefined,device=capability.deviceActions as Record<string,unknown>|undefined;
    if (capability.protocol!==1 || capability.agentId!==agentId || typeof capability.identityId!=='string' || !/^[a-f0-9-]{36}$/.test(capability.identityId) || external?.subject!==identity.userId || external?.organizationId!==identity.organizationId || typeof external?.issuer!=='string' || !external.issuer.startsWith('https://') || device?.protocol!==1 || !Array.isArray(device.capabilities) || !device.capabilities.includes('calendar.local-event.v1')) throw new Error('Cloud runtime owner capability was not verified');
    if(Array.isArray(device?.capabilities)&&device.capabilities.includes("reminders.local-record.v2"))target.headers["X-Eliza-Device-Capabilities"]+=",reminders.local-record.v2";else if(Array.isArray(device?.capabilities)&&device.capabilities.includes("reminders.local-record.v1"))target.headers["X-Eliza-Device-Capabilities"]+=",reminders.local-record.v1";
    if(Capacitor.getPlatform()==='android'&&device?.capabilities?.includes("clock.handoff.v1"))target.headers["X-Eliza-Device-Capabilities"]+=",clock.handoff.v1";
    if(Array.isArray(device?.capabilities)&&device.capabilities.includes('notes.query.v1'))target.headers['X-Eliza-Device-Capabilities']+=',notes.query.v1';
    if(Array.isArray(device?.capabilities)&&device.capabilities.includes('reminders.create.v1'))target.headers['X-Eliza-Device-Capabilities']+=',reminders.create.v1';
    if(Capacitor.getPlatform()==='android')for(const capability of ['calendar.create.v1','calendar.next-read.v1'])if(device.capabilities.includes(capability))target.headers['X-Eliza-Device-Capabilities']+=','+capability;
    if(Array.isArray(device?.capabilities)&&device.capabilities.includes("maps.selected-read.v1"))target.headers["X-Eliza-Device-Capabilities"]+=",maps.selected-read.v1";
    if(availabilityNegotiated(device?.capabilities))target.headers["X-Eliza-Device-Capabilities"]+=","+CALENDAR_AVAILABILITY_CAPABILITY;
    session.ownerId=capability.identityId;
    const registered=await request('/api/client-devices/register',{label:'Alpha Phone',workflowProtocol},signal);
    if (registered.installationId!==credential.installationId || typeof registered.enrollmentId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId)) throw new Error('Cloud device registration was not verified');
    const profileReason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);

    credential.enrollmentId=registered.enrollmentId; await secureConnectionStore.write(slot,credential); signal.throwIfAborted();
    credential.capabilities=target.headers["X-Eliza-Device-Capabilities"].split(",");
    next.actions=new DeviceActions(session,credential,await actionScope(JSON.stringify([baseScope,credential.installationId])),request,actionJournal,(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity)=>deviceExecutor(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:"unknown"}),target.headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),target.headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    next.revokeDevice=async revokeSignal=>{try{await client.phoneRequest(target,'/api/client-devices/revoke',revokeSignal,{});return true;}catch{revokeSignal.throwIfAborted();return false;}};
    next.request=request;
    next.phoneTarget=target; next.voiceExpiresAt=Math.min(auth.expiresAt ?? Infinity,Date.now()+30*60*1000);
    await secureConnectionStore.write(`cloud-runtime:${session.sessionId}`,{environment:cloud.environment,credentialId:auth.credentialId,origin:session.origin,agentId,ownerId:session.ownerId,userId:identity.userId,organizationId:identity.organizationId,sessionId:session.sessionId,expiresAt:next.voiceExpiresAt});
    signal.throwIfAborted(); cloud.setPhoneTarget(target); reason=profileReason;
  } catch (error) {
    signal.throwIfAborted();
    if (expired(error)) throw error;
    next.actions=undefined;next.phoneTarget=undefined;next.voiceExpiresAt=undefined;next.revokeDevice=undefined;session.ownerId=identity.userId;
  }
  await verifyPersonalOwner();signal.throwIfAborted();
  save({ kind:'cloud',environment:cloud.environment,agentId,ownerId:identity.userId });
  activate(next,session,agent.name || 'Eliza Cloud agent'); attached=true; update({phoneCapabilityReason:reason});
  await restoreSavedHistory(signal);
}

/**
 * Production builds have no mock mode. A stored mock choice from an older or test
 * build becomes "no selection": the chooser opens and nothing resumes on its own.
 * Paused native collectors stay paused until an explicit connection choice.
 */
function migrateLegacyMock(): boolean {
  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem(SELECTION) || 'null'); } catch { return false; }
  if (!stored || typeof stored !== 'object' || (stored as { kind?: unknown }).kind !== 'mock') return false;
  try { save({ kind: 'none' }); } catch { /* The open chooser still requires an explicit choice. */ }
  update({ open: true, message: 'This version connects to real agents only. Choose how to connect your agent.' });
  return true;
}
/**
 * Every Alpha Phone signs in to Eliza Cloud and holds a plan. The retired "Use local apps without
 * AI" choice is migrated to this gate on the next launch: only that preference is replaced, and no
 * data, history or credential is removed. A signed-out phone shows the sign-in gate.
 */
async function startResidentGate(){
  if(localAppsSelected()){try{save({kind:'none'});}catch{/* The gate below applies either way. */}}
  await work('Checking your Cloud account…',async signal=>{
    const credential=await cloudCredentialStore.read(residentEnvironment());
    signal.throwIfAborted();
    if(!credential){update({open:true,residentSubscription:null,residentSavedCredential:false,residentGate:null,message:''});return;}
    await connectResident(signal);
  });
}
function conversationKey(session: VerifiedSession) { return JSON.stringify([session.origin, session.ownerId, session.agentId]); }
async function ensureSelectedConversation(selected:Active,session:VerifiedSession,signal:AbortSignal,current:()=>void):Promise<string>{
 const key=conversationKey(session),cached=await captureConversationChoice(key,signal);current();
 let id=conversationMemory.has(key)?conversationMemory.get(key):cached?.id;
 if(typeof id!=='string'||!id){
  const created=selected.kind==='cloud'?await selected.cloud.createConversation(selected.agentId,'Alpha Phone',signal):await selected.remote.createConversation('Alpha Phone',signal);current();id=created.id;
  let saved=true;try{await selectConversation(key,cached,id,signal,current);}catch{saved=false;}
  current();conversationMemory.set(key,id);update({});
  if(!saved)update({message:'Conversation is connected for this session. Its selection could not be saved for restart.'});
 }
 if(!conversationMemory.has(key)){current();conversationMemory.set(key,id);}
 return id;
}

/** Only remove an exact Alpha-generated prefix from restored user prose. */
function restoredText(text: string, userTextFormat?:unknown): string {
  // An explicit format, including an unknown future value, is never a legacy
  // transport envelope. Preserve literal authored banners byte for byte.
  if(userTextFormat!==undefined)return text;
  const marker = '\n[/CURRENT-TURN CLIENT OBSERVATION]\n[USER MESSAGE]\n';
  const end = text.indexOf(marker);
  if (!text.startsWith('[CURRENT-TURN CLIENT OBSERVATION]\n') || end < 0) return text;
  try {
    const lastLine = text.slice(0, end).split('\n').at(-1)!;
    const { source, ...context } = JSON.parse(lastLine);
    const prose = text.slice(end + marker.length);
    if (source === 'Alpha Phone client' && phoneContextMessage(prose, context).text === text) return prose;
  } catch { /* Unrecognized text remains authored text. */ }
  return text;
}
function restoredMessages(items:Record<string,unknown>[]):RestoredMessage[] {
  return items.filter(item=>item.role==='user'||item.role==='assistant').map(item=>{
    if(typeof item.id!=='string'||!item.id||typeof item.text!=='string'||item.text.length>200000)throw Error('The agent returned invalid history.');
    return {id:item.id,from:item.role==='user'?'user':'agent',text:item.role==='user'?restoredText(item.text,item.userTextFormat):item.text};
  });
}
/** Eliza Cloud's API answers credentialed browser requests only from Eliza's own origins
 * (pinned upstream `cloud-api-hono-cors.ts`), so the flag-off web build cannot sign in or read the
 * account. It offers the account page instead of a sign-in that would always fail. */
/** Says what a refused pairing means. Nothing was connected; 401 and 503 keep their shared wording. */
function pairingError(error: unknown, withCode: boolean): unknown {
  if (!(error instanceof RemoteProtocolError) || error.status === 401 || error.status === 503) return error;
  const text = ['invalid_origin', 'origin_required', 'https_required'].includes(error.code) ? 'Enter the agent’s HTTPS address without a path, for example https://your-agent.example. Nothing was sent.'
    : error.code === 'pairing_unavailable' ? 'This agent is not accepting pairing. Enable pairing on the agent, then try again.'
    : error.code === 'session_expired' ? 'The saved session for this agent has expired. Enter a new pairing code.'
    : ['owner_session_required', 'machine_session_required', 'identity_changed', 'pairing_identity_mismatch'].includes(error.code) ? 'The agent did not confirm an owner session for this phone. Nothing was connected.'
    : error.code === 'remote_request_failed' && withCode && error.status !== undefined && error.status >= 400 && error.status < 500 ? 'The agent refused this pairing code. Codes expire and work once; ask your agent for a new one.'
    : 'The agent did not answer as expected. Nothing was connected.';
  return new Error(text, { cause: error });
}
const PAIRING_RETIRED = 'Pairing is unavailable. Your agent runs on this phone; sign in to Eliza Cloud for inference.';
export const WEB_CLOUD_UNAVAILABLE = 'Eliza Cloud sign-in is available in the Alpha Phone Android app. Eliza Cloud does not accept sign-in requests from this web page.';
/** Stop closes the transport and asks the agent to cancel through upstream's
 * `POST /api/turns/:roomId/abort` (resident, remote and local agents). Cloud agents and agents that
 * refuse that route keep the honest "may still finish" state. Either way one later read of the
 * conversation shows the reply if the agent finished it before or despite the cancel. */
const STOPPED_REPLY_CHECK_MS = 15_000;
export const STOPPED_REPLY_NOTICE = 'The agent may still finish this reply. Alpha Phone will check once and show it here if it does.';
export const STOPPED_CONFIRMED_NOTICE = 'The agent stopped this reply.';
export const STOPPED_CANCELLED_NOTICE = 'The agent cancelled this reply. Alpha Phone will check once in case it had already finished.';
let stoppedReply: { timer: ReturnType<typeof setTimeout>; controller: AbortController } | null = null;
function cancelStoppedReply() { if (!stoppedReply) return; clearTimeout(stoppedReply.timer); stoppedReply.controller.abort(); stoppedReply = null; }
function scheduleStoppedReply(selected: Active, session: VerifiedSession, conversationId: string, text: string, sentAt: number, delay = STOPPED_REPLY_CHECK_MS) {
  cancelStoppedReply();
  const generation = epoch, controller = new AbortController();
  // The check belongs to the stopped conversation: selecting another one retires it.
  const current = () => !controller.signal.aborted && generation === epoch && selected === active && state.session?.sessionId === session.sessionId && conversationMemory.get(conversationKey(session)) === conversationId;
  // An earlier turn's confirmed stop is not this turn's outcome.
  update({ replyNotice: STOPPED_REPLY_NOTICE, ...(state.message === STOPPED_CONFIRMED_NOTICE ? { message: '' } : {}) });
  let cancelled = false;
  // The single reconciliation read waits for the cancel attempt, so it reports the settled outcome.
  const cancelAttempt = selected.kind === 'cloud' ? Promise.resolve() : selected.remote.abortTurn(conversationId, controller.signal).then(outcome => {
    if (outcome !== 'aborted' || !current() || stoppedReply?.controller !== controller) return;
    cancelled = true; update({ replyNotice: STOPPED_CANCELLED_NOTICE });
  }, () => {});
  const timer = setTimeout(() => { void (async () => {
    try {
      await cancelAttempt;
      // Never replace the visible chat while the user has started another request.
      if (!current()) return;
      if (sending || operation) { update({ replyNotice: 'Load this conversation from Agent connection to see whether the stopped reply finished.' }); return; }
      const result = await readConversation(selected, conversationId, controller.signal, () => { if (!current()) throw Error('The agent changed.'); });
      if (!current()) return;
      // Another operation began during the read: say so instead of leaving "will check once" standing.
      if (sending || operation) { update({ replyNotice: 'Load this conversation from Agent connection to see whether the stopped reply finished.' }); return; }
      const user = [...result.messages].reverse().find(item => item.role === 'user' && typeof item.text === 'string' && restoredText(item.text, item.userTextFormat) === text && (typeof item.timestamp !== 'number' || item.timestamp >= sentAt - 120_000));
      const index = user ? result.messages.indexOf(user) : -1;
      const reply = user && (result.messages.find(item => item.role === 'assistant' && item.replyToMessageId === user.id) ?? result.messages.slice(index + 1).find(item => item.role === 'assistant' && item.replyToMessageId === undefined));
      if (!user) { update({ replyNotice: 'The agent did not record the stopped message.' }); return; }
      if (!reply || typeof reply.text !== 'string' || !reply.text.trim()) { update(cancelled ? { replyNotice: '', message: STOPPED_CONFIRMED_NOTICE } : { replyNotice: 'The agent had not finished the stopped reply when Alpha Phone checked. Load conversations later to see it.' }); return; }
      update({ history: { sessionId: session.sessionId, conversationId, revision: (state.history?.revision || 0) + 1, messages: restoredMessages(result.messages), automatic: true }, historyPartial: result.partial, replyNotice: '', message: 'The agent finished the stopped reply.' });
    } catch { if (current()) update({ replyNotice: 'The stopped reply could not be checked. Load conversations from Agent connection to see it.' }); }
    finally { if (stoppedReply?.controller === controller) stoppedReply = null; }
  })(); }, delay);
  stoppedReply = { timer, controller };
}
async function conversationList(selected: Active, signal: AbortSignal) {
  const list = selected.kind === 'cloud' ? await selected.cloud.listConversations(selected.agentId, signal) : await selected.remote.listConversations(signal);
  return list.map(item => ({ id: item.id, title: typeof item.title === 'string' && item.title ? item.title : 'Conversation' }));
}

async function restoreConversationHistory(id:string,signal:AbortSignal,automatic:boolean) {
  const selected=active,session=state.session,generation=epoch;
  if(!selected||!session)throw Error('Connect an agent first.');
  const account=selected.kind==='resident'&&residentGate()?service:null;
  if(selected.kind==='resident'&&residentGate()&&!account)throw Error('Cloud account is unavailable.');
  const assertCurrent=()=>{signal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId||account&&(service!==account||state.cloudAccount?.sessionId!==account.identity.sessionId))throw Error('The agent or account changed.');};
  const assertAccount=async()=>{
    assertCurrent();
    if(account){const credential=await cloudCredentialStore.read(account.identity.environment);assertCurrent();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}
  };
  const key=conversationKey(session),expected=await captureConversationChoice(key,signal);
  await assertAccount();
  if(automatic&&expected?.id!==id)throw Error('Saved conversation selection changed.');
  const list=await conversationList(selected,signal);await assertAccount();
  if(!list.some(item=>item.id===id))throw Error('This conversation is no longer available to this agent.');
  const result=await readConversation(selected,id,signal,assertCurrent);
  assertCurrent();
  const messages=restoredMessages(result.messages);
  await assertAccount();
  let saved=true;
  if(!automatic)try{await selectConversation(key,expected,id,signal,assertCurrent);}catch{saved=false;}
  await assertAccount();
  if(automatic){
    const current=Capacitor.getPlatform()==='android'?captureConversationChoice(key,signal):await captureConversationChoice(key,signal);
    assertCurrent();
    if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Saved conversation selection changed.');
  }
  conversationMemory.set(key,id);
  const older=result.partial?' Older messages remain on the agent.':'';
  // An explicit reload already shows whether a stopped reply finished; the pending check is retired.
  if(!automatic)cancelStoppedReply();
  update({history:{sessionId:session.sessionId,conversationId:id,revision:(state.history?.revision||0)+1,messages,automatic},historyError:'',historyPartial:result.partial,...(automatic?{}:{open:false,replyNotice:''}),message:(automatic?'Saved conversation restored.':saved?'Conversation restored.':'History restored for this session; restart selection could not be saved.')+older});
}
/** Restored chats are bounded; anything older stays on the agent and is reported as partial. */
const HISTORY_LIMIT=2000, HISTORY_PAGE=200;
/** Reads the recent window, then pages older messages with ?before=<createdAt>&beforeId=<id> until
 * the agent reports hasMore:false. A server that does not report hasMore for an older page (or
 * rejects the cursor) ends paging without duplicating messages. Messages stay oldest first. */
async function readConversation(selected:Active,id:string,signal:AbortSignal,assertCurrent:()=>void):Promise<{messages:Record<string,unknown>[];partial:boolean}> {
  const first=selected.kind==='cloud'?await selected.cloud.messages(selected.agentId,id,signal):await selected.remote.messages(id,signal);
  assertCurrent();
  let messages=first.messages.slice(),partial=false;
  const seen=new Set(messages.map(item=>item.id));
  // Cloud's adapter does not expose the older-page cursor yet; a full recent window may be partial.
  if(selected.kind==='cloud')return {messages:messages.slice(-HISTORY_LIMIT),partial:messages.length>=HISTORY_PAGE};
  while(messages.length){
    if(messages.length>=HISTORY_LIMIT){partial=true;break;}
    const oldest=messages[0],cursor=oldest.timestamp;
    if(typeof cursor!=='number'||!Number.isSafeInteger(cursor)||cursor<0){partial=messages.length>=HISTORY_PAGE;break;}
    const page:MessagePage={before:cursor,limit:HISTORY_PAGE,...(typeof oldest.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oldest.id)?{beforeId:oldest.id}:{})};
    let older:{messages:Record<string,unknown>[];hasMore?:boolean};
    try{older=await selected.remote.messages(id,signal,page);}
    catch(error){signal.throwIfAborted();assertCurrent();partial=messages.length>=HISTORY_PAGE;break;}
    assertCurrent();
    if(typeof older.hasMore!=='boolean'){partial=messages.length>=HISTORY_PAGE;break;}
    const fresh=older.messages.filter(item=>!seen.has(item.id)&&typeof item.timestamp==='number'&&item.timestamp<=cursor);
    for(const item of fresh)seen.add(item.id);
    fresh.sort((a,b)=>(a.timestamp as number)-(b.timestamp as number));
    messages=[...fresh,...messages];
    if(!older.hasMore)break;
    if(!fresh.length){partial=true;break;}
  }
  if(messages.length>HISTORY_LIMIT){messages=messages.slice(-HISTORY_LIMIT);partial=true;}
  return {messages,partial};
}
/** Restores the saved conversation for any verified connection (resident, remote or Cloud).
 * The resident-specific name is kept for existing contract tests. */
const restoreSavedResidentHistory=(signal:AbortSignal)=>restoreSavedHistory(signal);
void restoreSavedResidentHistory;
async function restoreSavedHistory(signal:AbortSignal) {
  const selected=active,session=state.session,generation=epoch;
  if(!selected||!session)return;
  try{
    const saved=await captureConversationChoice(conversationKey(session),signal);signal.throwIfAborted();
    if(generation!==epoch||selected!==active||state.session!==session)return;
    if(saved)await restoreConversationHistory(saved.id,signal,true);
  }catch(error){
    signal.throwIfAborted();
    if(generation!==epoch||selected!==active||state.session!==session)return;
    update({historyError:'Saved conversation could not be restored. Your selected conversation was kept. Retry from Agent connection.',message:'Connected. Saved history needs another check.'});
  }
}

type HistoryEntry = { id:string; state:string; operation:unknown; local?:{status?:string;phase?:string;createdAt?:unknown;applyingAt?:unknown;finishedAt?:unknown;record?:Record<string,unknown>} };
const actionStateLabels:Record<string,string>={pending:'Waiting for your review',executing:'Started on this phone',reconciliation_required:'Needs your review',completed:'Completed',rejected:'Rejected',expired:'Expired',failed:'Not completed'};
/** Plain-language action history. Operation JSON never reaches the screen. */
export function presentActionEntry(entry:HistoryEntry,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
  const operation=entry.operation as {type?:unknown;title?:unknown;text?:unknown}|null;
  let title='',detail='';
  try{const presented=presentDeviceRecordOperation(operation as never,timeZone);if(typeof presented?.title==='string'){title=presented.title;detail=presented.description.split('\n').map(line=>line.trim()).find(line=>line&&line!==presented.title)||'';}}catch{/* Other operations use the generic label below. */}
  if(!title){
    const type=typeof operation?.type==='string'?operation.type:'';
    title=type==='post_notification'?'Post notification':type==='speak_text'?'Read text aloud':type?type.replace(/[_-]+/g,' ').replace(/^./,letter=>letter.toUpperCase()):'Phone action';
    detail=typeof operation?.title==='string'?`“${operation.title}”`:'';
  }
  if(detail.length>160)detail=detail.slice(0,157)+'…';
  const local=entry.local,status=local?.status||local?.phase;
  const when=[local?.finishedAt,local?.applyingAt,local?.createdAt].find((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  const timestamp=when===undefined?'':new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone}).format(new Date(when));
  const outcome=status?`${actionStateLabels[entry.state]||entry.state} · this phone: ${status}`:`${actionStateLabels[entry.state]||entry.state} · not dispatched by this phone`;
  return {id:entry.id,state:entry.state,title,detail,outcome,timestamp,description:[title,detail,outcome,timestamp].filter(Boolean).join(' · ')};
}
async function readActionHistory(selected:Active,signal:AbortSignal,sync=false){
  if(!selected.actions)throw new Error('Verified phone actions are unavailable on this connection.');
  if(sync)await selected.actions.syncReceipts(signal);
  return (await selected.actions.history(signal) as HistoryEntry[]).map(entry=>presentActionEntry(entry));
}
/** After connecting, surface uncertain phone actions so the user can record what happened. */
async function refreshActionReview(signal:AbortSignal){
  const selected=active,generation=epoch;
  if(!selected?.actions)return;
  try{
    const entries=await readActionHistory(selected,signal);
    if(generation!==epoch||selected!==active)return;
    const review=entries.some(entry=>entry.state==='reconciliation_required');
    update({actionHistory:entries,...(review?{open:true,message:'A phone action needs your review. Check this phone, then record whether it happened.'}:{})});
  }catch{signal.throwIfAborted();/* The history stays available from Phone action history. */}
}
function boundNavigation():ViewNavigationClient|undefined {
 const selected=active,session=state.session,generation=epoch;
 if(!selected?.request||!session||!navigationContext)return undefined;
 return selected.viewNavigation??=new ViewNavigationClient(selected.request,()=>active===selected&&state.session===session&&epoch===generation&&!state.open&&!state.busy,()=>navigationContext?.()??null);
}

/** Shared controller for the chat adapter. Snapshot contains no credentials.
 * subscribe/getSnapshot expose connection changes; send uses server-bound identity
 * and one persisted conversation per origin+owner+agent. It never executes proposals.
 */
export const connectionController = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot() { return state; },
  async assistantDraftBinding(signal:AbortSignal){
    const selected=active,session=state.session,generation=epoch;
    signal.throwIfAborted();
    if(!selected||!session)return JSON.stringify(['offline']);
    const key=conversationKey(session),saved=await captureConversationChoice(key,signal);
    signal.throwIfAborted();if(generation!==epoch||selected!==active||session!==state.session)throw Error('The agent changed while opening its draft.');
    // Pin even an empty choice: another tab's restart preference cannot move this draft.
    if(!conversationMemory.has(key))conversationMemory.set(key,saved?.id||'');
    return JSON.stringify([session.origin,session.ownerId,session.agentId,conversationMemory.get(key)||null]);
  },
  setDeviceRecovery(recovery: DeviceRecovery) { deviceRecovery=recovery; },
  cancelViewNavigation(){active?.viewNavigation?.cancel();},
  setNavigationContext(read:()=>ContextEnvelope|null){navigationContext=read;},
  captureViewNavigation(context:ContextEnvelope){const client=boundNavigation();return client?{client,attempt:client.capture(context)}:undefined;},
  setDeviceExecutor(executor: DeviceExecutor) { deviceExecutor = executor; },
  setForegroundExecutor(executor: ForegroundReviewExecutor) { foregroundExecutor = executor; },
  setDeviceReadReview(review:(proposal:ActionProposal,context:ContextEnvelope,signal:AbortSignal)=>Promise<void>){deviceReadReview=review;},
  async execute(proposal: ActionProposal, context: ContextEnvelope, signal: AbortSignal): Promise<OperationReceipt> {
    const selected = active;
    if (!selected || !selected.actions) return { proposalId: proposal.id, status: 'denied', summary: 'This connection does not support verified phone actions.' };
    const session=state.session!,sessionId=session.sessionId,generation=epoch,account=JSON.stringify(service?.identity??null),conversation=conversationMemory.get(conversationKey(session)),review=deviceReadReview;
    const prior = actionReceipts.get(proposal.id);
    if (prior?.sessionId === sessionId) return prior.result;
    const result = (async()=>{
      if(proposal.privateNotesRead){
        if(!review)throw Error('Notes review is unavailable. Nothing was shared.');
        await review(proposal,context,signal);signal.throwIfAborted();
        if(selected!==active||generation!==epoch||state.session!==session||conversationMemory.get(conversationKey(session))!==conversation||JSON.stringify(service?.identity??null)!==account||document.hidden||state.open)throw Error('The Notes review changed. Nothing was shared.');
      }
      return selected.actions!.approve(proposal.id, context, signal);
    })();
    actionReceipts.set(proposal.id, { sessionId, result });
    return result;
  },
  async pendingActions(context:ContextEnvelope,signal:AbortSignal):Promise<ActionProposal[]> {
    const selected=active,session=state.session,generation=epoch,history=state.history;
    if(!selected?.actions||!session||state.open||state.busy||document.hidden||context.sensitive)return [];
    const account=selected.kind==='resident'&&residentGate()?service:null;
    if(selected.kind==='resident'&&residentGate()&&!account)throw Error('Cloud account is unavailable.');
    const current=()=>{signal.throwIfAborted();if(generation!==epoch||selected!==active||state.session!==session||state.history!==history||state.open||state.busy||document.hidden||account&&(service!==account||state.cloudAccount?.sessionId!==account.identity.sessionId))throw Error('The agent or conversation changed.');};
    const checkAccount=async()=>{current();if(account){const credential=await cloudCredentialStore.read(account.identity.environment);current();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}};
    const key=conversationKey(session),choice=await captureConversationChoice(key,signal);
    await checkAccount();
    const proposals=await selected.actions.pending(context,signal);
    await checkAccount();
    const after=Capacitor.getPlatform()==='android'?captureConversationChoice(key,signal):await captureConversationChoice(key,signal);
    current();if(JSON.stringify(choice)!==JSON.stringify(after))throw Error('Saved conversation selection changed.');
    return proposals;
  },
  async approvePendingAction(id:string,context:ContextEnvelope,signal:AbortSignal):Promise<OperationReceipt> {
    // Refresh authenticated state and exact source preconditions at the tap. No
    // cached chat prose or prior approval can authorize a recovered proposal.
    const selected=active,session=state.session;
    const proposals=await this.pendingActions(context,signal);
    signal.throwIfAborted();
    if(active!==selected||state.session!==session)throw Error('The agent changed.');
    const proposal=proposals.find(proposal=>proposal.id===id);
    if(!proposal)throw Error('This action is no longer pending for the current screen. Open its original selection and review again.');
    return this.execute(proposal,context,signal);
  },
  getWorkflowPresentationProtocol():1|2 { return active?.actions ? active.workflowProtocol ?? 1 : 1; },
  getWorkflowDeviceTarget(){const selected=active;if(!selected||!selected.actions||!selected.actions.credential.enrollmentId)return null;return {installationId:selected.actions.credential.installationId,enrollmentId:selected.actions.credential.enrollmentId};},
  async workflowNoticeActions(review:WorkflowPhoneReview,signal:AbortSignal){
    const selected=active,generation=epoch,sessionId=state.session?.sessionId;
    if(!selected?.actions||state.open||document.hidden)throw new Error('Connection unavailable for notice validation');
    const result=await selected.actions.pendingWorkflowNotice(review,signal);signal.throwIfAborted();
    if(generation!==epoch||sessionId!==state.session?.sessionId||state.open||document.hidden)throw new Error('Workflow owner changed');return result;
  },
  async workflowPhoneActions(review:WorkflowPhoneReview,context:ContextEnvelope,signal:AbortSignal){
    const selected=active,generation=epoch,sessionId=state.session?.sessionId;
    if(!selected||!selected.actions||state.open||document.hidden||context.sensitive)throw new Error('Open this workflow on the selected phone agent');
    const result=await selected.actions.pendingForWorkflow(review,context,signal);signal.throwIfAborted();
    if(generation!==epoch||sessionId!==state.session?.sessionId||state.open||document.hidden)throw new Error('Workflow agent changed');return result;
  },
  async rejectWorkflowPhoneAction(id:string,review:WorkflowPhoneReview,context:ContextEnvelope,signal:AbortSignal){
    const selected=active;if(!selected||!selected.actions||state.open||document.hidden||context.sensitive)throw new Error('Open this workflow to deny its phone step');
    const proposals=await selected.actions.pendingForWorkflow(review,context,signal);if(!proposals.some(p=>p.id===id))throw new Error('Phone step is no longer pending');signal.throwIfAborted();await selected.actions.reject(id,signal);
  },
  async syncWorkflowPhoneReceipts(review:WorkflowPhoneReview,signal:AbortSignal){
    const selected=active,generation=epoch;
    if(!selected||!selected.actions||state.open||document.hidden)throw new Error('Open this workflow to reconcile its phone receipts');
    await selected.actions.syncReceipts(signal,{runId:review.runId,versionId:review.versionId,specDigest:review.specDigest});signal.throwIfAborted();if(generation!==epoch||state.open||document.hidden)throw new Error('Workflow agent changed');
  },
  async actionReceipt(proposalId: string, sessionId: string | undefined): Promise<OperationReceipt | null> {
    const tracked = actionReceipts.get(proposalId);
    if (!sessionId || state.session?.sessionId !== sessionId || tracked?.sessionId !== sessionId) return null;
    const receipt = await tracked.result;
    return state.session?.sessionId === sessionId ? receipt : null;
  },
  readReplyBinding(conversationId:string,proposalId:string,digest:string):ReadReplyBinding {
    const session=state.session;
    if(!active?.actions||!session||state.open||document.hidden||conversationMemory.get(conversationKey(session))!==conversationId)throw Error('Return to the original conversation to review this Notes request.');
    const binding={conversationId,session:{...session},connectionEpoch:epoch,cloudAccount:JSON.stringify(service?.identity??null)};
    readReplyOwners.set(binding,{actions:active.actions,proposalId,digest,cancelled:false});return binding;
  },
  readReplyCurrent(binding:ReadReplyBinding){
    return !!readReplyOwners.get(binding)&&!readReplyOwners.get(binding)!.cancelled&&this.voiceConversationCurrent(binding,false)&&binding.cloudAccount===JSON.stringify(service?.identity??null)&&!state.open&&!document.hidden;
  },
  async completeReadReply(hint:NativeNotesReadReplyHint,binding:ReadReplyBinding,signal:AbortSignal){
    const selected=active,account=service,owned=readReplyOwners.get(binding);
    const current=()=>{signal.throwIfAborted();if(!selected?.actions||owned?.actions!==selected.actions||owned.proposalId!==hint.proposalId||owned.digest!==hint.digest||active!==selected||!this.readReplyCurrent(binding)||hint.conversationId!==binding.conversationId)throw Error('The original Notes conversation changed.');};
    const checkAccount=async()=>{current();if(account){const credential=await cloudCredentialStore.read(account.identity.environment);current();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}};
    await checkAccount();
    current();const reply=await selected!.actions!.completeReadReply(hint,signal);await checkAccount();return reply;
  },
  async cancelReadReply(binding:ReadReplyBinding){
    const owned=readReplyOwners.get(binding);if(!owned||owned.cancelled)return;
    owned.cancelled=true;
    try{await owned.actions.cancelReadReply(owned.proposalId,owned.digest,new AbortController().signal);}finally{readReplyOwners.delete(binding);}
  },
  async actionHistory(sync = false) {
    await work('Reading phone action history…', async signal => {
      const selected = active, generation = epoch;
      if (!selected || !selected.actions) throw new Error('Verified phone actions are unavailable on this connection.');
      const entries = await readActionHistory(selected, signal, sync);
      if (generation !== epoch) return;
      update({ actionHistory: entries, message: 'Review local effects before resolving an uncertain action. No action is repeated here.' });
    });
  },
  async rejectAction(id: string) {
    await work('Rejecting phone action…', async signal => {
      if (!active || !active.actions) throw new Error('Device action connection unavailable');
      await active.actions.reject(id, signal);
      update({ actionHistory: [], message: 'Proposal rejected. No device action was performed.' });
    });
  },
  /** Reject one pending proposal without opening the connection dialog (chat cards use this). */
  async rejectProposal(id: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const selected = active, generation = epoch;
    if (!selected?.actions) throw new Error('This connection does not support verified phone actions.');
    await selected.actions.reject(id, signal);
    signal.throwIfAborted();
    if (generation === epoch && selected === active) update({ actionHistory: state.actionHistory.map(entry => entry.id === id ? { ...entry, state: 'rejected', outcome: `${actionStateLabels.rejected} · not dispatched by this phone`, description: [entry.title, entry.detail, `${actionStateLabels.rejected} · not dispatched by this phone`].filter(Boolean).join(' · ') } : entry) });
  },
  /** Record the user's check of an uncertain action. Nothing is executed or repeated. */
  async reconcile(entryId: string, applied: boolean, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const selected = active, generation = epoch;
    if (!selected?.actions) throw new Error('This connection does not support verified phone actions.');
    await selected.actions.reconcile(entryId, applied ? 'applied' : 'not_applied', signal);
    signal.throwIfAborted();
    if (generation === epoch && selected === active) update({ actionHistory: (await readActionHistory(selected, signal).catch(() => state.actionHistory.filter(entry => entry.id !== entryId))) });
  },
  async reconcileAction(id: string, outcome: 'applied' | 'not_applied') {
    await work('Recording your action review…', async signal => {
      if (!active || !active.actions) throw new Error('Device action connection unavailable');
      await active.actions.reconcile(id, outcome, signal);
      update({ actionHistory: [], message: 'Review recorded. Refresh action history; no action was repeated.' });
    });
  },
  getAutomationsClient(): {sessionId:string;scope?:string;request:(path:string,method:AutomationsMethod,body:unknown|undefined,signal:AbortSignal)=>Promise<unknown>} | null {
    const selected=active,session=state.session,generation=epoch;
    if(!selected||!session||(selected.kind==='cloud'&&!selected.phoneTarget))return null;
    return {sessionId:session.sessionId,scope:selected.actions?.scope,request:async(path,method,body,signal)=>{
      if(!automationsRouteAllowed(path,method)||((method==='GET'||method==='DELETE')&&body!==undefined))throw Error('Unsupported automation request');
      const controller=new AbortController(),bounded=AbortSignal.any([signal,controller.signal]);automationsRequests.add(controller);
      const current=()=>{bounded.throwIfAborted();if(generation!==epoch||selected!==active||session!==state.session)throw new DOMException('The connection changed','AbortError');};
      try{
        current();
        let result:unknown;
        if(selected.kind==='cloud')result=await selected.cloud.phoneRequest(selected.phoneTarget!,path,bounded,body,method);
        else if(selected.kind==='resident')result=await selected.remote.request(path,body,bounded,{},method);
        else {
          const credential=await remoteCredentialStore.read(selected.origin);current();
          if(!credential||credential.identityId!==session.ownerId||credential.expiresAt<=Date.now())throw Error('Pair the agent again');
          const response=await nativeRemoteRequest({url:selected.origin+path,method,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${credential.token}`},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:bounded});current();
          const latest=await remoteCredentialStore.read(selected.origin);current();
          if(!latest||latest.token!==credential.token||latest.identityId!==session.ownerId||latest.expiresAt<=Date.now())throw new DOMException('The paired account changed','AbortError');
          if(response.status<200||response.status>=300)throw new WorkflowHttpError(response.status,response.body);
          result=response.body;
        }
        current();return result;
      }catch(error){if(error instanceof CloudProtocolError&&error.status)throw new WorkflowHttpError(error.status,error.data);if(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'&&!(error instanceof WorkflowHttpError))throw new WorkflowHttpError(error.status,'data' in error?error.data:undefined);throw error;}
      finally{automationsRequests.delete(controller);}
    }};
  },
  getWorkflowClient(): { client: WorkflowProtocol; sessionId: string; scope?:string } | null {
    const selected = active, session = state.session;
    if (!selected || !session || (selected.kind==='cloud' && !selected.phoneTarget)) return null;
    const generation = epoch;
    return { sessionId: session.sessionId, scope:selected.actions?.scope, client: new WorkflowProtocol(async (path, body, signal) => {
      signal.throwIfAborted();
      if (generation !== epoch) throw new Error('Agent changed');
      if (selected.kind==='cloud') { try { const response=await selected.cloud.phoneRequest(selected.phoneTarget!,path,signal,body); if(generation!==epoch)throw new Error('Agent changed');return response; } catch(error) { if(error instanceof CloudProtocolError && error.status)throw new WorkflowHttpError(error.status,error.data); throw error; } }
      if(selected.kind==='resident'){try{const response=await selected.remote.request(path,body,signal);if(generation!==epoch)throw Error('Agent changed');return response;}catch(error){if(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number')throw new WorkflowHttpError(error.status,'data' in error?error.data:undefined);throw error;}}
      const credential = await remoteCredentialStore.read(selected.origin);
      if (!credential || credential.identityId !== session.ownerId || credential.expiresAt <= Date.now()) throw new Error('Pair the agent again');
      const response = await nativeRemoteRequest({ url: selected.origin + path, method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', 'Content-Type':'application/json', Authorization: `Bearer ${credential.token}` }, ...(body===undefined?{}:{body:JSON.stringify(body)}), signal });
      if (generation !== epoch) throw new Error('Agent changed');
      if (response.status<200||response.status>=300) throw new WorkflowHttpError(response.status, response.body);
      return response.body;
    }) };
  },
  getResidentReadingBinding(){return active?.kind==='resident'&&state.session?{execution:'device' as const,ownerId:state.session.ownerId,sessionId:state.session.sessionId}:null;},
  getBrowserSpeechAgent(){return active?.kind==='resident'&&state.session&&active.remote.browserSpeechAvailable?active.remote:null;},
  async refreshDeveloperVoiceHistory(binding:VoiceConversationBinding,signal:AbortSignal){if(!browserLocalAgentEnabled||active?.kind!=='resident'||!this.voiceConversationCurrent(binding))throw Error('Developer voice conversation changed');await restoreConversationHistory(binding.conversationId,signal,true);if(!this.voiceConversationCurrent(binding))throw Error('Developer voice conversation changed');},
  getPairedVoiceBinding(): { origin: string; ownerId: string; expiresAt: number; sessionId: string } | null {
    if(browserDevProfile&&selection()?.kind==='development'&&state.session)return {...state.session,expiresAt:developmentVoiceExpiresAt};
    if (active?.kind==='cloud' && state.session && active.phoneTarget && active.voiceExpiresAt && active.voiceExpiresAt>Date.now()) return {origin:state.session.origin,ownerId:state.session.ownerId,expiresAt:active.voiceExpiresAt,sessionId:state.session.sessionId};
    if (!active || active.kind === 'cloud' || active.kind === 'resident' || !state.session || !active.remote.session || active.remote.session.expiresAt <= Date.now()) return null;
    return { origin: active.origin, ownerId: state.session.ownerId, expiresAt: active.remote.session.expiresAt, sessionId: state.session.sessionId };
  },
  getCloudEnvironment(): CloudEnvironment | null { return service?.identity.environment ?? null; },
  getCloudClient(): { client: CloudProtocol; sessionId: string; credentialId: string } | null { return service ? { client: service.client, sessionId: service.identity.sessionId, credentialId: service.identity.credentialId } : null; },
  rejectCloudSession(sessionId: string, error: unknown) {
    if (!expired(error) || service?.identity.sessionId !== sessionId) return false;
    const environment = service.identity.environment;
    if (active?.kind === 'cloud' && active.cloud.environment === environment) retire('Sign-in required');
    detachService();
    update({ error: testMocksEnabled?'Eliza Cloud sign-in has expired. Sign in again; remote agent pairing is unchanged.':'Eliza Cloud sign-in has expired. Sign in again to use managed services.' });
    return true;
  },
  open() { update({ open: true, purpose:'agent', error: '' }); },
  openCloudAccount(){
    update({open:true,purpose:'cloud-account',message:'',error:''});
    // Production Android: whether a Cloud sign-in is kept on this phone decides if the panel offers
    // "Retry saved connection". A local keystore read; no Cloud request and nothing is restored.
    if(residentGate()&&!state.cloudAccount)void cloudCredentialStore.read(residentEnvironment()).then(credential=>{if(state.open&&state.purpose==='cloud-account'&&!state.cloudAccount)update({residentSavedCredential:!!credential?.credentialId});}).catch(()=>{/* Sign-in stays available. */});
  },
  /** Settings › Eliza Cloud account & plan: the plan panel with Redeem code, Manage plan and Sign out. */
  openPlan(){ update({open:true,purpose:'plan',message:'',error:'',redeemError:'',redeemNotice:''}); },
  /** Test-mocks builds only: enter or leave subscription gate QA, then reload into it. */
  setResidentQa(environment:CloudEnvironment|null){
    if(!testMocksEnabled||operation)return;
    try{if(environment)localStorage.setItem(RESIDENT_QA,environment);else localStorage.removeItem(RESIDENT_QA);}catch{update({error:'Subscription gate QA could not be saved.'});return;}
    location.reload();
  },
  /** Plan state for Settings. Null when this build has no plan gate. */
  residentPlanSettings(){
    if(!residentGate())return null;
    const view=state.residentSubscription,account=state.cloudAccount,plan=view&&view.kind!=='checking'?describeSubscription(view):null;
    const expiresAt=account?.expiresAt??null;
    if(state.residentGate==='offline'&&!account){const recent=readPlanAdmission();return {signedIn:false,offline:true,account:null,plan:recent?`${recent.planName} · offline`:'Offline',status:recent?.status??null,endsAt:state.planEndsAt??null,keyExpiresAt:null,keyExpiring:false};}
    return {signedIn:!!account,offline:false,account:account?(account.email||`Account ${account.userId.slice(0,8)}`):null,
      plan:state.residentGate==='needs-plan'&&view?.kind!=='inactive'?'No active plan':plan?.headline??(account?'Checking plan…':'Not signed in'),
      status:view?.kind==='active'?view.status:view?.kind==='inactive'?view.status:null,
      endsAt:state.planEndsAt??null,keyExpiresAt:expiresAt,keyExpiring:expiresAt!==null&&expiresAt-Date.now()<=CLOUD_KEY_EXPIRY_WARNING_MS};
  },
  close() { if(residentGate() && !state.session&&state.residentGate!=='offline'){if((state.purpose==='cloud-account'||state.purpose==='plan')&&!state.busy)update({purpose:'agent',message:'',error:'',redeemError:'',redeemNotice:''});return;} if (!state.busy) {if(state.purpose!=='cloud-account'&&state.purpose!=='plan')clearPersonalSetup();update({ open: false,purpose:'agent',redeemError:'',redeemNotice:'' });} },
  cancel() { operation?.abort(new DOMException('Cancelled', 'AbortError')); cloud.cancelLogin(); },
  async initialize() {
    if (startup) return startup;
    startup = (async () => {
      if(browserDevProfile){const saved=selection();if(saved?.kind==='development'){if(saved.account!==(await readDevelopmentIdentity(saved.profile)).account){save({kind:'none'});return;}await work('Restoring development agent…',signal=>connectDevelopment(saved.profile,signal));return;}}
      // A selected development host can restore its existing Mac-owned Cloud account.
      // The server returns only a reference; canonical identity still owns readiness.
      if(cloudCredentialStore.acceptsReferences&&!isAndroid&&!browserDevProfile&&selection()?.kind!=='offline'&&new URLSearchParams(location.search).get('mode')!=='mock'){
        const restoreEpoch=epoch;
        const canRestore=()=>restoreEpoch===epoch&&!operation&&!state.open&&selection()?.kind!=='offline';
        try{
          const credential=await cloudCredentialStore.read('production');
          // A user choice during discovery also retires automatic agent startup.
          if(!canRestore())return;
          // An optional empty host store is not an account onboarding action.
          if(credential?.credentialReference&&credential.credentialId){
            const expected={credentialId:credential.credentialId,credentialReference:credential.credentialReference};
            await work('Checking your Cloud account…',async signal=>{
              const current=await cloudCredentialStore.read('production');signal.throwIfAborted();
              if(restoreEpoch!==epoch||current?.credentialId!==expected.credentialId||current?.credentialReference!==expected.credentialReference)throw Error('Cloud account changed. Try again.');
              await verifyService(makeCloud('production'),signal,expected);
            });
            if(restoreEpoch!==epoch||state.error||service?.identity.credentialId!==expected.credentialId)return;
          }
        }catch(error){if(canRestore())await work('Checking your Cloud account…',async()=>{throw error;});return;}
      }
      // A build that cannot use Eliza Cloud signs a saved Cloud service out on every start, whatever is selected
      // (an offline choice included): the marker and, best effort and unawaited, the stored Cloud key. Only that
      // slot; it is not read. No request is made.
      if (webCloudUnavailable()) { try { localStorage.removeItem(CLOUD_SERVICE); } catch { /* Nothing is restored either way. */ } void removeStoredCloudCredential('production').catch(() => {}); }
      // Subscription gate QA in a test-mocks build runs the production gate before any development flow.
      if (residentQa()) { await startResidentGate(); return; }
      if (!testMocksEnabled && migrateLegacyMock()) return;
      if (testMocksEnabled && ((!isAndroid && !browserLocalAgentEnabled) || new URLSearchParams(location.search).get('mode') === 'mock')) return;
      if (!testMocksEnabled && !isAndroid && !browserLocalAgentEnabled) {
        // A production browser build has no on-device agent. Explain the real choices once.
        let stored: string | null = null;
        try { stored = localStorage.getItem(SELECTION); } catch { /* Unavailable storage still shows the choice. */ }
        if (stored === null) { try { save({ kind: 'none' }); } catch { /* The chooser explains the choice either way. */ } update({ open: true, message: '' }); return; }
      }
      const saved = selection();
      if(!testMocksEnabled&&!isAndroid&&!browserLocalAgentEnabled){
        // Preserve legacy selection and history for recovery; never read credentials or reconnect.
        update({open:saved?.kind!=='offline',message:'Your agent runs locally in the Android app. Local apps remain available here.'});return;
      }
      if (residentGate()) { await startResidentGate(); return; }
      if (saved?.kind === 'offline') return;
      if (saved?.kind === 'mock') { const url = new URL(location.href); url.searchParams.set('mode', 'mock'); location.replace(url.href); return; }
      await work('Restoring your connection…', async signal => {
        if (webCloudUnavailable()) {
          // A saved Cloud agent is not restored: the service was signed out above without a request or a stored-token read.
          if (saved?.kind === 'cloud') { try { save({ kind: 'none' }); } catch { /* The chooser still requires a choice. */ } update({ open: true, message: '', error: WEB_CLOUD_UNAVAILABLE }); return; }
        }
        const environment = localStorage.getItem(CLOUD_SERVICE);
        if (environment === 'staging' && !testMocksEnabled) { localStorage.removeItem(CLOUD_SERVICE); update({ message: 'Sign in with Eliza Cloud to continue.' }); }
        else if (cloudEnvironmentAllowed(environment)) {
          try { await verifyService(makeCloud(environment), signal); }
          catch (error) { signal.throwIfAborted(); detachService(); update({ message: 'Cloud services need sign-in or retry. Your agent connection is independent.' }); }
        }
        if (saved?.kind === 'resident') { await connectResident(signal); return; }
        // `npm run dev` starts the agent on this computer; connect to it on first launch. An explicit choice (including offline) is kept.
        if (!saved && !isAndroid && browserLocalAgentEnabled) { await connectResident(signal); return; }
        if (!saved || saved.kind === 'none') { update({ open: !service, message: 'Choose where to run your agent.' }); return; }
        if (saved.kind === 'cloud') {
          cloud = makeCloud(saved.environment);
          const identity=await verifyService(cloud,signal);
          if(saved.ownerId&&identity.userId!==saved.ownerId)throw Error('The Cloud account changed. Review your personal agent before connecting.');
          await inspectPersonal(signal);
          const current=state.cloudPersonal;
          if(saved.ownerId&&current?.view?.kind==='ready'&&!current.blocked)await connectCloud(current.view.identity.activeAgentId!,signal,saved.ownerId,current.view.identity.apiBase,personalSetup?.client.owner);
          else update({open:true});
        }
        else if(saved.kind==='remote'||saved.kind==='local')await connectRemote(saved.kind, saved.origin, '', signal);
      });
    })().finally(()=>update({startupResolved:true}));
    return startup;
  },
  async offline() {
    if (operation) return;
    // Every Alpha Phone signs in to Eliza Cloud and holds a plan: the gate has no local-only bypass.
    if(residentGate()){update({open:true,error:'Alpha Phone needs an Eliza Cloud account with a plan.',message:''});return;}
    retire(); detachService();
    const error = persistOffline();
    update({ open: Boolean(error), error, message: '' });
  },
  async stopLocal() { await work('Stopping the local agent…',async()=>{await stopLocalAgent();retire();save({kind:'none'});update({message:'Local agent stopped.'});}); },
  async configureLocal(apiKey:string,model:string=LOCAL_PROVIDER_MODEL) { await work('Checking the key with Cerebras…',async()=>{await configureLocalProvider(apiKey,model);update({providerStatus:await localProviderStatus().catch(()=>null),message:'Key verified with Cerebras. Provider saved. Start or restart the local agent to use it.'});}); },
  async refreshProviderStatus() { try { update({ providerStatus: await localProviderStatus() }); } catch { update({ providerStatus: null }); } },
  /** Stops the running agent (its process holds the key), deletes the key and confirms removal. */
  async removeProvider() {
    await work('Removing the provider key…', async () => {
      if (active?.kind === 'resident') { await stopLocalAgent(); await retire(); save({ kind: 'none' }); }
      const status = await clearLocalProvider();
      update({ providerStatus: status, message: 'Provider key removed from this phone. Add a key before starting the local agent again.' });
    });
  },
  /** Start a fresh conversation on the connected agent and make it the restart selection. */
  async newConversation() {
    if (sending) { update({ error: 'Wait for the current reply before starting a new conversation.' }); return; }
    await work('Starting a new conversation…', async signal => {
      const selected = active, session = state.session, generation = epoch;
      if (!selected || !session) throw new Error('Connect an agent first.');
      const assertCurrent = () => { signal.throwIfAborted(); if (generation !== epoch || selected !== active || state.session?.sessionId !== session.sessionId) throw Error('The agent changed.'); };
      const key = conversationKey(session), expected = await captureConversationChoice(key, signal); assertCurrent();
      const created = selected.kind === 'cloud' ? await selected.cloud.createConversation(selected.agentId, 'Alpha Phone', signal) : await selected.remote.createConversation('Alpha Phone', signal);
      assertCurrent();
      let saved = true;
      try { await selectConversation(key, expected, created.id, signal, assertCurrent); } catch { saved = false; }
      assertCurrent(); conversationMemory.set(key, created.id); cancelStoppedReply();
      update({ history: { sessionId: session.sessionId, conversationId: created.id, revision: (state.history?.revision || 0) + 1, messages: [], automatic: false }, historyError: '', historyPartial: false, replyNotice: '', open: false, message: saved ? 'New conversation started.' : 'New conversation started for this session; restart selection could not be saved.' });
    });
  },
  async authorDevelopment(profile:DevelopmentProfile,json:string){if(!devSurfacesEnabled)return;await work('Preparing development action…',async signal=>{await authorDevelopmentAction(profile,json,signal);update({message:'Action queued. Send a chat message to review it on the current screen.'});});},
  async startDevelopment(profile:DevelopmentProfile){if(!devSurfacesEnabled)return;await work('Starting development agent…',signal=>connectDevelopment(profile,signal));},
  async saveDevelopment(profile:DevelopmentProfile,reply:string){if(!devSurfacesEnabled)return;await work('Saving development reply…',async signal=>{await saveDevelopmentReply(profile,reply,signal);update({message:'Development reply saved.'});});},
  async startLocal() { await work('Starting the local agent…', signal => { retire(); return connectResident(signal); }); },
  async pair(kind: 'remote' | 'local', origin: string, code: string) {
    if (remotePairingRetired) { update({ error: PAIRING_RETIRED }); return; }
    await work('Verifying your agent…', async signal => { retire(); try { await connectRemote(kind, origin, code, signal); } catch (error) { throw pairingError(error, !!code.trim()); } });
  },
  async residentCloudLogin() {
    await work('Opening Eliza Cloud sign-in…',async signal=>{
      // A running process retains its environment; stop it before replacing credentials.
      if(isAndroid)await stopLocalAgent(); await retire(); detachService();
      update({residentSubscription:null,residentGate:null,redeemError:'',redeemNotice:''}); cloud=makeCloud(residentEnvironment());
      await cloud.login(signal,()=>update({message:'Finish signing in to Eliza Cloud in your browser, then return here.'}));
      await connectResident(signal);
    });
  },
  /** Opens the hosted plan page in the system browser; the plan is checked again on return. */
  async residentManagePlan() {
    await work('Opening Eliza Cloud plans…',async signal=>{await makeCloud(residentEnvironment()).openSubscriptionManagement(signal);update({message:'Choose or manage your plan in Eliza Cloud, then return here. Alpha checks your plan again when you come back.'});});
  },
  /**
   * Redeems a subscription code for the signed-in account, then checks the plan again and admits
   * the agent when the plan allows. Each submission gets a fresh idempotency key; only a transport
   * retry inside the protocol reuses it. The code is never stored, logged or echoed.
   */
  async residentRedeem(code:string) {
    if(operation)return;
    const idempotencyKey=crypto.randomUUID();
    update({redeemError:'',redeemNotice:''});
    await work('Redeeming your code…',async signal=>{
      const account=service;
      if(!account)throw Error('Sign in with Eliza Cloud first.');
      let result;
      try{result=await account.client.redeemSubscriptionCode(code,idempotencyKey,signal);}
      catch(error){if(error instanceof SubscriptionRedeemError){update({redeemError:redeemFailureMessage(error),message:''});return;}throw error;}
      if(service!==account)throw Error('Cloud account changed. Sign in again.');
      if(result.grantEndsAt!==null&&!result.paidPlanTakesPrecedence)update({planEndsAt:result.grantEndsAt});
      update({redeemNotice:redeemSuccessMessage(result),purpose:'agent'});
      const endsAt=result.paidPlanTakesPrecedence?null:result.grantEndsAt;
      await connectResident(signal);
      if(endsAt!==null){const record=readPlanAdmission();if(record&&record.credentialId===account.identity.credentialId){writePlanAdmission({...record,endsAt});update({planEndsAt:endsAt});}}
    });
  },
  /** Checks the plan again after the owner returns from Eliza Cloud (resume or visibility). */
  recheckPlanOnReturn() {
    if(!residentGate()||operation||state.busy)return;
    // Offline admission started nothing, so returning or reconnecting retries the whole admission.
    if((state.residentGate==='needs-plan'&&state.cloudAccount)||state.residentGate==='offline'){void connectionController.startLocal();return;}
    entitlementRefresher?.refreshNow();
  },
  async cloudLogin(environment: CloudEnvironment) {
    const accountOnly=state.purpose==='cloud-account';
    if(residentGate()){await connectionController.residentCloudLogin();return;}
    if(!testMocksEnabled && !isAndroid && !browserLocalAgentEnabled){update({open:true,error:WEB_CLOUD_UNAVAILABLE,message:''});return;}
    await work('Opening Eliza Cloud sign-in…', async signal => {
      // A login can replace the environment's secure token with a different
      // account. Detach the old identity before any token can be replaced.
      const replacingCloud = active?.kind === 'cloud' || selection()?.kind === 'cloud';
      detachCloudTarget(); detachService(); if (replacingCloud) save({ kind: 'none' }); update({ agents: [] });
      cloud = makeCloud(environment);
      await cloud.login(signal, () => update({ message: accountOnly?'Finish signing in to Eliza Cloud in your browser, then return here. If the link expires, cancel and sign in again.':'Use the newly opened browser tab to sign in and approve this phone. If the link expires, cancel here and start a fresh sign-in.' }));
      await verifyService(cloud, signal);
      if (!active) save({ kind: 'none' });
      if(accountOnly)update({message:'Signed in to Eliza Cloud.'});else await inspectPersonal(signal);
    });
  },
  async cloudList(environment: CloudEnvironment) {
    if(!testMocksEnabled){update({error:PAIRING_RETIRED});return;}
    if (webCloudUnavailable()) { update({ open: true, error: WEB_CLOUD_UNAVAILABLE, message: '' }); return; }
    await work('Loading your agents…', async signal => { cloud = makeCloud(environment);
      if (service && service.identity.environment !== environment) { detachCloudTarget(); detachService(); }
      const previous = service?.identity.sessionId;
      try { await verifyService(cloud, signal); }
      catch (error) { if (previous) connectionController.rejectCloudSession(previous, error); throw error; }
      if (!active) save({ kind: 'none' });
      await inspectPersonal(signal); });
  },
  cloudEnvironment(environment: CloudEnvironment) {
    if (operation || !cloudEnvironmentAllowed(environment)) return;
    clearPersonalSetup(); cloud = makeCloud(environment); update({ agents: [], message: '', error: '' });
  },
  // Cloud connects only to the account's personal agent: a running Dedicated agent connects via
  // cloudPersonalConnect; otherwise the reviewed Dedicated setup or Manage Cloud account applies.
  cloudPersonalDecline(){if(operation)return;clearPersonalSetup();update({cloudPersonal:{view:null,blocked:false,declined:true},message:'Cloud account connected. Dedicated setup was not started.',error:''});},
  async cloudPersonalAccept(){await personalWork('Submitting the reviewed setup…',async(binding,view,signal)=>{
   if(view.kind!=='review'||state.cloudPersonal?.blocked)throw Error('Refresh setup status before continuing.');
   const generation=personalGeneration,attempt=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:view.review.personalElizaId,dedicatedAgentId:view.review.dedicatedAgentId,state:'attempting'},null,signal);
   await personalDispatch(binding,generation,attempt,signal);
   let next:PersonalView,intent:PersonalIntent|null=attempt;
   try{next=await binding.client.accept(view.review,signal);}
   catch(error){if(error instanceof PersonalProtocolError&&error.code==='http'&&error.status!==undefined&&error.status>=400&&error.status<500){await clearPersonalIntent(binding.client.owner,attempt);if(personalCurrent(binding,generation))update({cloudPersonal:{view:null,blocked:false,declined:false}});}throw error;}
   if(next.kind==='review'||next.kind==='unavailable'){await clearPersonalIntent(binding.client.owner,attempt);intent=null;}
   else if(next.kind==='pending')intent=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:next.receipt.personalElizaId,dedicatedAgentId:next.receipt.dedicatedAgentId,state:'accepted'},attempt);
   if(personalCurrent(binding,generation)){await publishPersonal(binding,next,intent,generation,signal);if(next.kind==='review')update({message:'The hosting terms changed. Review the current quote before continuing.'});}
  });},
  async cloudPersonalPoll(){await personalWork('Checking setup status…',async(binding,view,signal)=>{const generation=personalGeneration,expected=await personalIntent(binding.client.owner,signal);const next=view.kind==='pending'?await binding.client.poll(view.receipt,signal):await binding.client.inspect(signal);if(personalCurrent(binding,generation))await publishPersonal(binding,next,expected,generation,signal);});},
  async cloudPersonalFinalize(){await personalWork('Completing personal agent setup…',async(binding,view,signal)=>{
   if(view.kind!=='pending'||view.phase!=='cutover'||state.cloudPersonal?.blocked)throw Error('Check setup status before continuing.');
   const generation=personalGeneration,prior=await personalIntent(binding.client.owner,signal);if(prior?.phase==='cutover')throw Error('Check the previous setup outcome before continuing.');if(prior&&(prior.personalElizaId!==view.receipt.personalElizaId||prior.dedicatedAgentId&&prior.dedicatedAgentId!==view.receipt.dedicatedAgentId))throw Error('Cloud setup target changed. Refresh its status.');
   const attempt=await savePersonalIntent(binding.client.owner,{phase:'cutover',personalElizaId:view.receipt.personalElizaId,dedicatedAgentId:view.receipt.dedicatedAgentId,state:'attempting'},prior,signal);
   await personalDispatch(binding,generation,attempt,signal);
   const next=await binding.client.finalize(view.receipt,signal);let intent:PersonalIntent=attempt;
   // A returned pending state is the protocol's explicit non-ambiguous retry permission.
   if(next.kind==='pending')intent=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:next.receipt.personalElizaId,dedicatedAgentId:next.receipt.dedicatedAgentId,state:'accepted'},attempt);
   else if(next.kind==='review'||next.kind==='unavailable')intent=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:view.receipt.personalElizaId,dedicatedAgentId:view.receipt.dedicatedAgentId,state:'accepted'},attempt);
   if(personalCurrent(binding,generation))await publishPersonal(binding,next,intent,generation,signal);
  });},
  async cloudPersonalRecovery(){
   if(!testMocksEnabled)return;
   const binding=personalSetup,generation=personalGeneration;if(Capacitor.getPlatform()==='android'||!binding||!personalCurrent(binding,generation)||operation)return;
   personalRecovery?.abort();const controller=personalRecovery=new AbortController(),check=()=>{controller.signal.throwIfAborted();if(!personalCurrent(binding,generation))throw Error('Cloud account changed.');};
   try{const domain=await personalIntentDocument(binding.client.owner);check();openDomainRecovery({async capture(signal){check();const value=await domain.capture(signal);check();return value;},async reset(expected,signal){check();await domain.reset(expected,signal);check();}},'Cloud setup intent','Cloud setup intent recovery','Download this account’s exact saved intent before resetting. An uncertain setup may already have started hosting. Check Cloud status first. Reset only clears local recovery; it does not stop hosting, revoke credentials or send another setup request.',controller.signal);}catch{if(!controller.signal.aborted&&personalCurrent(binding,generation))update({error:'Cloud setup recovery could not be opened.'});}
  },
  async cloudManage(environment:CloudEnvironment){if(!testMocksEnabled){update({error:PAIRING_RETIRED});return;}await work('Opening Cloud account…',signal=>openConnectionBrowser(testMocksEnabled&&environment==='staging'?'https://cloud-staging.eliza.app/cloud/agents':'https://cloud.eliza.app/cloud/agents',signal));},
  async cloudPersonalConnect(){await personalWork('Verifying your personal Cloud agent…',async(binding,_view,signal)=>{
   const generation=personalGeneration,expected=await personalIntent(binding.client.owner,signal),next=await binding.client.inspect(signal);if(!personalCurrent(binding,generation))return;await publishPersonal(binding,next,expected,generation,signal);
   if(next.kind!=='ready'||state.cloudPersonal?.blocked)throw Error('Your personal Cloud agent is not ready.');
   await connectCloud(next.identity.activeAgentId!,signal,binding.client.owner.userId,next.identity.apiBase,binding.client.owner);
  });},
  /** Revoke on the agent first (device enrollment, then owner session), then forget the local
   * credential and this phone's device installation key. */
  async disconnect() {
    await work('Disconnecting…', async signal => {
      const previous = active; const retirement=retire();
      save({ kind: 'none' });
      await retirement;
      let revoked: boolean | null = null;
      if (previous?.kind === 'remote' || previous?.kind === 'local') {
        const result = await previous.remote.revoke(previous.deviceHeaders ?? null, signal);
        revoked = result.session && (!previous.deviceHeaders || result.device);
      } else if (previous?.kind === 'cloud') revoked = previous.revokeDevice ? await previous.revokeDevice(signal) : null;
      else if (previous) await previous.remote.disconnect();
      if (previous?.deviceSlot) await secureConnectionStore.remove(previous.deviceSlot);
      update({ message: revoked === false
        ? 'Agent disconnected on this phone, but the agent did not confirm revocation. Remove this phone from the agent’s paired devices.'
        : revoked ? 'Agent disconnected. This phone’s access was revoked on the agent. Cloud services keep their separate sign-in.' : 'Agent disconnected. Cloud services keep their separate sign-in.', error: '', agents: [] });
    });
  },
  async cloudSignOut() {
    await work('Signing out of Cloud services…', async signal => {
      if(residentGate()){stopEntitlementRefresh();if(isAndroid)await stopLocalAgent();await retire();writePlanAdmission(null);update({residentSubscription:null,residentGate:null,planEndsAt:null,redeemError:'',redeemNotice:''});}
      const previous = service; detachCloudTarget(); detachService();
      localStorage.removeItem(CLOUD_SERVICE);
      if (!active) save({ kind: 'none' });
      const client = (previous?.client ?? cloud) as CloudProtocol;
      // Only a confirmed server-side revocation counts. A transport or server that does not offer
      // the route ({supported:false}) or a failed request removes this phone's token only, and the copy says so.
      let revoked = false;
      if (typeof client.revokeSession === 'function') { try { const result = await client.revokeSession(signal); revoked = result?.supported === true && result.revoked === true; } catch { /* Unconfirmed. A cancelled or failed revocation still removes the local token below. */ } }
      await client.disconnect();
      update({ agents: [], residentSavedCredential:false, ...(residentGate()?{purpose:'agent' as const}:{}), message: revoked ? 'Signed out of Eliza Cloud. This sign-in was revoked.' : 'Signed out of Eliza Cloud on this phone. The sign-in token was removed here; Eliza Cloud did not confirm revoking it.' });
    });
  },
  async mock() {
    if (!testMocksEnabled) return;
    await work('Pausing live services before mock mode…', async signal => {
      const { pauseLiveActivityForMock } = await import('./mock-admission');
      // Retire renderer actions immediately, then await both live native barriers.
      const results=await Promise.allSettled([retire(),pauseLiveActivityForMock()]);
      if(results.some(result=>result.status==='rejected'))throw Error('Live background activity could not be paused. Retry before opening mock mode.');
      signal.throwIfAborted();
      save({ kind: 'mock' });
      detachService(); const url = new URL(location.href); url.searchParams.set('mode', 'mock'); location.assign(url.href);
    });
  },
  async listHistory() {
    if (sending) { update({ error: 'Wait for the current reply before loading conversations.' }); return; }
    await work('Loading conversations from your selected agent…', async signal => {
      const selected = active, session = state.session, generation = epoch;
      if (!selected || !session) throw new Error('Connect an agent first.');
      const list = await conversationList(selected, signal); signal.throwIfAborted();
      if (generation !== epoch) throw new Error('The agent changed.');
      update({ conversations: list, message: list.length ? 'Choose a conversation to replace the visible chat. Your draft will be cleared.' : 'No saved conversations were returned.' });
    });
  },
  async restoreHistory(id: string) {
    if (sending) { update({ error: 'Wait for the current reply before restoring history.' }); return; }
    await work('Verifying and restoring conversation…',signal=>restoreConversationHistory(id,signal,false));
  },
  async retrySavedHistory(){if(sending)return;await work('Checking saved conversation…',signal=>restoreSavedHistory(signal));},
  messageTargetCurrent(target:ConversationMessageTarget) {
    return !!active&&!!state.session&&!state.open&&!state.busy&&!sending&&!operation&&validateUuid(target.messageId)&&target.conversationId===conversationMemory.get(conversationKey(state.session))&&JSON.stringify(target.session)===JSON.stringify(state.session);
  },
  canEditMessages(){return !!active&&active.kind!=='cloud';},
  async truncateMessage(target:ConversationMessageTarget):Promise<void> {
    if(!this.messageTargetCurrent(target)||target.from!=='user'||!active||active.kind==='cloud'||document.hidden)throw Error('This message cannot be edited in the current connection.');
    const selected=active,session=state.session!,generation=epoch,controller=new AbortController(),contextKey=JSON.stringify(navigationContext?.());operation=controller;update({busy:true});let dispatched=false;
    const current=()=>{controller.signal.throwIfAborted();if(document.hidden||state.open||generation!==epoch||selected!==active||JSON.stringify(state.session)!==JSON.stringify(session)||conversationMemory.get(conversationKey(session))!==target.conversationId)throw Error('The conversation changed.');};
    try {
      const history=await selected.remote.messages(target.conversationId,controller.signal);current();
      const row=history.messages.find(row=>row.id===target.messageId);
      if(!row||row.role!=='user'||row.source==='local_command'||typeof row.text!=='string'||restoredText(row.text,row.userTextFormat)!==target.text)throw Error('This message changed. Reload its conversation before editing.');
      if(JSON.stringify(navigationContext?.())!==contextKey)throw Error('The active screen changed. Nothing was replaced.');
      dispatched=true;await selected.remote.truncateMessages(target.conversationId,target.messageId,controller.signal);current();
      await restoreConversationHistory(target.conversationId,controller.signal,true);current();
    } catch(error) {
      if(dispatched){if(generation===epoch)update({historyError:'Message replacement may have changed history. Reload the conversation before another edit.'});throw Object.assign(new Error('Message replacement needs a history check. Nothing was resent automatically.'),{historyChanged:true,cause:error});}
      throw error;
    } finally {if(operation===controller){operation=null;update({busy:false});}}
  },
  voiceConversationCurrent(binding:VoiceConversationBinding,foreground=true){
    return !!active&&(!foreground||!state.open&&!state.busy&&!document.hidden)&&binding.connectionEpoch===epoch&&JSON.stringify(state.session)===JSON.stringify(binding.session)&&conversationMemory.get(conversationKey(binding.session))===binding.conversationId;
  },
  async prepareVoiceConversation(signal:AbortSignal):Promise<VoiceConversationBinding>{
    if(operation||sending||state.open||state.busy||document.hidden)throw Error('Finish the current connection or conversation operation first.');
    const selected=active,session=state.session,generation=epoch;
    if(!selected||!session)throw Error('Connect an agent in Settings to start a voice conversation.');
    if((selected.kind==='remote'||selected.kind==='local')&&(!selected.remote.session||selected.remote.session.expiresAt<=Date.now()))throw Error('Your session expired. Pair again before starting voice.');
    const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();operation=controller;
    const current=()=>{controller.signal.throwIfAborted();if(document.hidden||state.open||generation!==epoch||selected!==active||JSON.stringify(state.session)!==JSON.stringify(session))throw Error('The voice conversation changed.');};
    try{current();const conversationId=await ensureSelectedConversation(selected,session,controller.signal,current);current();return {conversationId,session:{...session},connectionEpoch:generation};}
    finally{signal.removeEventListener('abort',cancel);if(operation===controller)operation=null;}
  },
  async send(text: string, context: ContextEnvelope, requestId: string, signal: AbortSignal, onText?:(text:string)=>void,replyTo?:ConversationMessageTarget,onReplyReady?:(results:readonly unknown[]|undefined)=>void,channelType:ChatChannel='DM',expectedConversationId?:string,voiceTurnSignal?:VoiceTurnSignal): Promise<{ messageId?:string;userMessageId?:string;messageBinding?:{conversationId:string;session:VerifiedSession};text: string; proposals?: ActionProposal[]; actionResults?:readonly unknown[] }> {
    if (operation) throw new Error('Finish the connection or history operation before sending.');
    if(replyTo&&!this.messageTargetCurrent(replyTo))throw Error('The reply target belongs to a different conversation.');
    const message = phoneContextMessage(text, context);
    if (sending) throw new Error('Wait for the current reply before sending another message.');
    const selected = active, session = state.session, generation = epoch;
    if (!selected || !session) throw new Error('Connect an agent in Settings to send a message.');
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    sending = controller;
    const requestSignal = controller.signal;
    let dispatched: { conversationId: string; at: number } | null = null;
    if (state.replyNotice) update({ replyNotice: '' });
    cancelStoppedReply();
    try {
      requestSignal.throwIfAborted();
      if (selected.kind === 'remote' || selected.kind === 'local') {
        if (!selected.remote.session || selected.remote.session.expiresAt <= Date.now()) throw Object.assign(new Error('Your session has expired. Pair again.'), { code: 'session_expired' });
      }
      const assertCurrent=()=>{requestSignal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId||(expectedConversationId!==undefined&&conversationMemory.get(conversationKey(session))!==expectedConversationId))throw Error('The connection or conversation changed.');};
      const id=await ensureSelectedConversation(selected,session,requestSignal,assertCurrent);
      if(expectedConversationId!==undefined&&id!==expectedConversationId)throw Error('The voice conversation changed.');
      if(replyTo&&(!validateUuid(replyTo.messageId)||replyTo.conversationId!==id||JSON.stringify(replyTo.session)!==JSON.stringify(session)))throw Error('The reply target belongs to a different conversation.');
      if(replyTo){const history=selected.kind==='cloud'?await selected.cloud.messages(selected.agentId,id,requestSignal):await selected.remote.messages(id,requestSignal);assertCurrent();const row=history.messages.find(row=>row.id===replyTo.messageId);if(!row||row.role!==(replyTo.from==='user'?'user':'assistant')||typeof row.text!=='string'||(replyTo.from==='user'?restoredText(row.text,row.userTextFormat):row.text)!==replyTo.text)throw Error('The reply target changed. Reload its conversation before replying.');}
      // Only the verified native resident profile negotiates verbatim prose
      // history. Other hosts retain the existing envelope and legacy alias.
      const nativeProse=isAndroid&&selected.kind==='resident'&&selected.userTextFormatVersion===1;
      const wireText=nativeProse?text:message.text;
      const options = { signal: requestSignal, clientMessageId: requestId, channelType, metadata: { ...(channelType==='VOICE_DM'&&voiceTurnSignal?{voiceTurnSignal}:{}), ...(replyTo?{replyToMessageId:replyTo.messageId}:{}), ...(message.context.timeZone===undefined?{}:{uiTimeZone:message.context.timeZone}), clientDevice: { context: message.context }, ...boundNavigation()?.metadata(context), ...(nativeProse?{userTextFormat:'plain-v1'}:{alphaPhone:{context:message.context}}) } };
      dispatched = { conversationId: id, at: Date.now() };
      const progress=(value:string)=>{requestSignal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId)throw Error('The connection changed.');onText?.(value);};
      const replyReady=(results:readonly unknown[]|undefined)=>{assertCurrent();onReplyReady?.(results);};
      const reply = selected.kind === 'cloud' ? await selected.cloud.send(selected.agentId, id, wireText, options) : selected.kind==='resident'?await selected.remote.send(id,wireText,{...options,onText:progress,onReplyReady:replyReady}):await selected.remote.send(id, wireText, options);
      requestSignal.throwIfAborted();
      assertCurrent();
      if(channelType==='VOICE_DM' && (('interrupted' in reply && reply.interrupted===true)||('noResponseReason' in reply && reply.noResponseReason==='ignored')))throw Error('The voice response did not complete. Check conversation history before speaking again.');
      let responseFailure: Error | undefined;
      if (('failureKind' in reply && reply.failureKind) || ('terminalFailure' in reply && reply.terminalFailure)) {
        const terminal = 'terminalFailure' in reply ? reply.terminalFailure : undefined;
        // Cloud's own refusal (rate limit, used allowance, no active plan) carries its retry
        // information; the phone presents it and never retries, upgrades or buys anything.
        const limit = readServiceLimit({ failureKind: 'failureKind' in reply ? reply.failureKind : undefined, terminalFailure: terminal });
        responseFailure = limit
          ? new AlphaClientError('transport-failed', serviceLimitMessage(limit))
          : new Error('The agent could not complete this response.');
      }
      for(const key of ['messageId','userMessageId'] as const)if(reply[key]!==undefined&&!validateUuid(reply[key]))throw Error('The agent returned an invalid message identity.');
      if (typeof reply.text !== 'string') throw new Error('The agent returned an invalid response.');
      let proposals: ActionProposal[] | undefined, notices: string[] = [];
      if (selected.actions) {
        // A pending action that does not fit this screen, time zone or negotiated support is
        // named to the owner instead of being dropped; it stays unapprovable.
        try { const items = await selected.actions.pendingReview(message.context, requestSignal); proposals = items.flatMap(item => item.proposal ? [item.proposal] : []); notices = items.flatMap(item => item.notice ? [item.notice.slice(0, 500)] : []).slice(0, 5); }
        catch { update({ message: 'Reply received. Phone action proposals could not be checked; use action history.' }); }
      }
      requestSignal.throwIfAborted();
      assertCurrent();
      // A failed reply can follow a durably recorded proposal. Recover only the
      // existing identity/context-bound review; never retry chat or execute it.
      if (responseFailure && !proposals?.length) throw responseFailure;
      return { text: responseFailure
        ? `${responseFailure.message} Pending phone actions are available for separate review. Nothing has been approved or performed automatically.`
        : reply.text, ...(notices.length ? { notices } : {}), ...(!responseFailure?{...(typeof reply.messageId==='string'?{messageId:reply.messageId}:{}),...(typeof reply.userMessageId==='string'?{userMessageId:reply.userMessageId}:{}),messageBinding:{conversationId:id,session:{...session}}}:{}), ...(proposals ? { proposals } : {}), ...(!responseFailure&&Array.isArray(reply.actionResults)?{actionResults:reply.actionResults}:{}) };
    } catch (error) {
      // Nothing carrying the message left this phone (no conversation, offline, changed owner, or a
      // Stop before the post): the composer keeps the text instead of reporting an unknown outcome.
      // The marker is set per failure: an error object seen after the post never keeps an earlier mark.
      const mark = (target: unknown) => { if (target && typeof target === 'object' && (!dispatched || 'notDispatched' in target)) try { Object.defineProperty(target, 'notDispatched', { value: !dispatched, configurable: true }); } catch { /* An unmarkable error stays an unknown outcome. */ } };
      mark(error);
      // Stop (or leaving the chat) after dispatch: the turn may still complete on the agent.
      if (signal.aborted && dispatched && generation === epoch && selected === active && state.session?.sessionId === session.sessionId) scheduleStoppedReply(selected, session, dispatched.conversationId, text, dispatched.at);
      if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
        const limited = new AlphaClientError('transport-failed', serviceLimitMessage(readServiceLimit(error)));
        // Rate-limited before the post (creating or reading the conversation): still provably unsent.
        mark(limited); throw limited;
      }
      if (expired(error) && generation === epoch) {
        retire('Sign-in required');
        update({ error: 'Sign in or pair again.', open: true });
        try {
          if (selected.kind === 'cloud') { detachService(); await selected.cloud.disconnect(); }
          else await selected.remote.disconnect();
        } catch {
          update({ error: 'The expired connection is detached, but its stored credential could not be removed.', open: true });
        }
      }
      throw error;
    } finally { signal.removeEventListener('abort', cancel); if (sending === controller) sending = null; }
  },
};

export function ConnectionChooser() {
  const snapshot = useSyncExternalStore(connectionController.subscribe, connectionController.getSnapshot);
  const [developmentAction,setDevelopmentAction]=useState('{"type":"create_note","title":"Development note","body":"Reviewed local action"}');
  const [developmentProfile,setDevelopmentProfile]=useState<DevelopmentProfile>('local'),[reply,setReply]=useState(''),[developmentError,setDevelopmentError]=useState('');
  const [replyReady,setReplyReady]=useState(false),[developmentAccountRevision,setDevelopmentAccountRevision]=useState(0);
  const agentRecovery=useRef<AbortController|null>(null);
  useEffect(()=>()=>{agentRecovery.current?.abort();},[developmentProfile]);
  useEffect(()=>{const retire=()=>agentRecovery.current?.abort(),hidden=()=>{if(document.hidden)retire();};const events=['pagehide','launcher-home','alpha:device-state','alpha:dev-incoming-call'];for(const event of events)window.addEventListener(event,retire);document.addEventListener('visibilitychange',hidden);return()=>{retire();for(const event of events)window.removeEventListener(event,retire);document.removeEventListener('visibilitychange',hidden);};},[]);
  useEffect(()=>{if(!browserDevProfile||!snapshot.open||snapshot.purpose==='cloud-account')return;const controller=new AbortController();setReplyReady(false);setReply('');setDevelopmentError('');void developmentReply(developmentProfile,controller.signal).then(value=>{if(!controller.signal.aborted){setReply(value);setReplyReady(true);}},()=>{if(!controller.signal.aborted)setDevelopmentError('Development data could not be read. Open agent history recovery to download or reset it.');});return()=>controller.abort();},[developmentProfile,snapshot.open,snapshot.purpose,developmentAccountRevision]);
  const recoverConversationChoice=async()=>{if(state.busy)return;sending?.abort(new DOMException('Conversation recovery requested.','AbortError'));agentRecovery.current?.abort();const controller=agentRecovery.current=new AbortController();try{const domain=await conversationSelectionDocument();controller.signal.throwIfAborted();connectionController.close();openDomainRecovery(domain,'conversation selections','Conversation selection recovery','Download saved conversation selections before resetting. This clears only browser restart choices; conversations remain on their agents. It does not delete conversations, messages or provider data. Reset never sends a message. Close older Alpha tabs before continuing.',controller.signal);}catch{if(!controller.signal.aborted)update({error:'Conversation selections could not be read.'});}};
  const recoverDevelopment=(kind:'agent'|'execution'|'digest')=>{try{const identity=developmentIdentity(developmentProfile),domain=developmentOwnerRecovery(kind==='agent'?developmentAgentDocument(identity):kind==='execution'?developmentExecutionDocument(identity):developmentDigestDocument(identity),identity);agentRecovery.current?.abort();const controller=agentRecovery.current=new AbortController();connectionController.close();if(kind==='agent')openDomainRecovery(domain,'agent history','Development agent history recovery','Download this profile’s conversations, scripted reply and message receipts before resetting. Reset clears only this development agent history and restores the default reply. Pending device actions, workflows and real local-agent data are separate. Close older Alpha tabs before continuing.',controller.signal);else if(kind==='execution')openDomainRecovery(domain,'execution history','Development execution recovery','Download this profile’s workflows, runs, action proposals and receipts before resetting. Reset clears them together so waiting workflows cannot recreate cleared proposals. Pending actions may already have happened: reconcile them before resetting. Reset does not undo effects. Older bytes are preserved inside a JSON archive. Real local-agent data is separate. Close older Alpha tabs before continuing.',controller.signal);else openDomainRecovery(domain,'digest schedules','Development digest schedule recovery','Download this profile’s read grants, sources, schedules, execution results and delivery acknowledgements before resetting. Reset removes these local schedules and grants. Already saved inbox results remain in the separate inbox. Real provider grants and real local-agent data are separate. Close older Alpha tabs before continuing.',controller.signal);}catch{setDevelopmentError('Development recovery could not be opened.');}};
  const [localPackaging,setLocalPackaging]=useState<'checking'|'available'|'unavailable'>('checking');
  useEffect(()=>{if(!snapshot.open||snapshot.purpose==='cloud-account')return;let current=true;setLocalPackaging('checking');void localAgentPackaged().then(available=>{if(current)setLocalPackaging(available?'available':'unavailable');});return()=>{current=false;};},[snapshot.open,snapshot.purpose]);
  const providerKey=useRef<HTMLInputElement>(null);
  const redeemCode=useRef<HTMLInputElement>(null);
  const qaEnvironment=useRef<HTMLSelectElement>(null);
  const [confirmRemove,setConfirmRemove]=useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const remoteOrigin = useRef<HTMLInputElement>(null), remoteCode = useRef<HTMLInputElement>(null);
  const localOrigin = useRef<HTMLInputElement>(null), localCode = useRef<HTMLInputElement>(null);
  const environment = useRef<HTMLSelectElement>(null);
  useEffect(() => { void connectionController.initialize(); }, []);
  // Plan state is checked again when the owner returns (for example from Eliza Cloud's plan page).
  useEffect(()=>{if(!residentGate())return;const visible=()=>{if(!document.hidden)connectionController.recheckPlanOnReturn();};document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',visible);window.addEventListener('online',visible);return()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',visible);window.removeEventListener('online',visible);};},[]);
  useEffect(()=>{
    if(isAndroid)return;
    const changed=(event:StorageEvent)=>{
      if(event.key!==SELECTION&&event.key!==CLOUD_SERVICE&&event.key!==null)return;
      agentRecovery.current?.abort();operation?.abort();
      if(event.key===SELECTION||event.key===null){
        void retire();
        if(event.key===null||selection()?.kind==='offline')detachService();
      }else{detachCloudTarget();detachService();}
      // Read preferences only. Another tab's choice must not trigger sign-in or
      // be overwritten by cancellation cleanup in this tab.
      update({open:false});
    };
    window.addEventListener('storage',changed);
    return()=>window.removeEventListener('storage',changed);
  },[]);

  useEffect(()=>{if(!browserDevProfile)return;const changed=()=>{const selected=selection();if(selected?.kind==='development'&&selected.profile==='cloud'){operation?.abort();sending?.abort();void retire();save({kind:'none'});}agentRecovery.current?.abort();setReplyReady(false);setDevelopmentAccountRevision(value=>value+1);};const stored=(event:StorageEvent)=>{if(event.key===developmentCloudKey||event.key===null)changed();};window.addEventListener('alpha:development-account-changed',changed);window.addEventListener('storage',stored);return()=>{window.removeEventListener('alpha:development-account-changed',changed);window.removeEventListener('storage',stored);};},[developmentProfile]);
  useEffect(() => {
    if (!browserDevProfile) return;
    const cancel = () => { agentRecovery.current?.abort();operation?.abort(); sending?.abort(); update({open:false}); };
    // Firefox can revoke storage during pagehide. Retire pending work without
    // asking the shell to read device storage in a departing document.
    const suspend = () => { developmentPageSuspended = true; cancel(); };
    const resume = () => { developmentPageSuspended = false; update({}); };
    const visibility = () => { if (document.hidden) suspend(); else resume(); };
    const events = ['launcher-home','alpha:device-state'];
    events.forEach(event => window.addEventListener(event,cancel));
    window.addEventListener('pagehide',suspend);
    window.addEventListener('pageshow',resume);
    document.addEventListener('visibilitychange',visibility);
    return () => {
      developmentPageSuspended = false;
      events.forEach(event => window.removeEventListener(event,cancel));
      window.removeEventListener('pagehide',suspend);
      window.removeEventListener('pageshow',resume);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[]);
  useEffect(() => {
    if (!snapshot.open) return;
    const previous = document.activeElement as HTMLElement | null;
    const phone = document.querySelector<HTMLElement>('.os');
    const releaseInert = holdPhoneInert(phone);

    if (phone && panel.current) {
      const theme = getComputedStyle(phone);
      // The dialog's accent colours text and focus rings, so it takes the theme's text accent
      // (--acct): the fill accent (--acc) is 2.4:1 against the dark background.
      for (const key of ['bg', 'fg', 's2', 'line', 'mut', 'acc']) panel.current.style.setProperty(`--connection-${key}`, theme.getPropertyValue(key === 'acc' ? '--acct' : `--${key}`));
    }
    panel.current?.focus();
    const back = (event: Event) => { if(document.querySelector("dialog[open]"))return; event.preventDefault(); event.stopImmediatePropagation(); if (snapshot.busy) connectionController.cancel(); else connectionController.close(); };
    window.addEventListener('alpha-back', back, true);
    const key = (event: KeyboardEvent) => {
      if(document.querySelector("dialog[open]"))return;
      if (event.key === 'Escape') { event.preventDefault(); if (snapshot.busy) connectionController.cancel(); else connectionController.close(); }
      if (event.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); window.removeEventListener('alpha-back', back, true); releaseInert(); previous?.focus(); };
  }, [snapshot.open, snapshot.busy,snapshot.purpose]);
  const env = (): CloudEnvironment => testMocksEnabled && environment.current?.value === 'staging' ? 'staging' : 'production';
  const browserOnly = !testMocksEnabled && !isAndroid && !browserLocalAgentEnabled;
  const cloudAccountControls=<>
    {browserOnly&&<p>{WEB_CLOUD_UNAVAILABLE}</p>}
    {snapshot.cloudAccount&&<section className="alpha-connection-current alpha-cloud-account-summary"><strong>{snapshot.cloudAccount.email||'Signed in to Eliza Cloud'}</strong>{!snapshot.cloudAccount.email&&<span>Account {snapshot.cloudAccount.userId}</span>}<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Sign out of Eliza Cloud</button></section>}
    {testMocksEnabled&&snapshot.purpose!=='cloud-account'&&<label>Environment<select aria-label="Environment" ref={environment} disabled={snapshot.busy} defaultValue="production" onChange={()=>connectionController.cloudEnvironment(env())}><option value="production">Production</option><option value="staging">Staging</option></select></label>}
    {!browserOnly&&(!snapshot.cloudAccount||snapshot.purpose!=='cloud-account')&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.cloudLogin(env())}>Sign in with Eliza Cloud</button></div>}
  </>;
  if (!snapshot.open) return null;
  const actionReview=snapshot.session&&snapshot.phoneActionsAvailable&&<details open={snapshot.actionHistory.some(item=>item.state==='reconciliation_required')}><summary>Phone action history</summary><button disabled={snapshot.busy} onClick={() => void connectionController.actionHistory()}>Refresh actions</button><button disabled={snapshot.busy} onClick={() => void connectionController.actionHistory(true)}>Sync recorded receipts</button>{snapshot.actionHistory.map(item => <section key={item.id} className="alpha-connection-agent"><strong>{item.title}</strong>{item.detail&&<span>{item.detail}</span>}<span>{item.outcome}{item.timestamp&&` · ${item.timestamp}`}</span>{item.state === 'pending' && <button disabled={snapshot.busy} onClick={() => void connectionController.rejectAction(item.id)}>Reject proposal</button>}{['executing','reconciliation_required'].includes(item.state) && <><p>After checking this phone, confirm whether this exact action happened.</p><button disabled={snapshot.busy} onClick={() => void connectionController.reconcileAction(item.id, 'applied')}>I verified it happened</button><button disabled={snapshot.busy} onClick={() => void connectionController.reconcileAction(item.id, 'not_applied')}>I verified it did not happen</button></>}</section>)}</details>;
  const conversations=snapshot.session&&<details><summary>Conversation history</summary><p>Load from this agent only. Restoring replaces the visible chat and draft; it does not run past actions.</p><button disabled={snapshot.busy} onClick={() => void connectionController.newConversation()}>New conversation</button><button disabled={snapshot.busy} onClick={() => void connectionController.listHistory()}>Load conversations</button>{snapshot.conversations.map(item => <section key={item.id} className="alpha-connection-agent"><strong>{item.title}</strong><button disabled={snapshot.busy} onClick={() => void connectionController.restoreHistory(item.id)}>Restore conversation</button></section>)}</details>;
  // The account panel Inbox opens ("Connect Eliza Cloud"). On production Android a sign-in kept on
  // this phone is offered here exactly as Settings › Agent connection offers it: "Retry saved
  // connection" starts the on-device agent with that sign-in (connectResident, never a remote or
  // Cloud-hosted agent), only when the owner asks. Until that succeeds nothing says the phone is
  // signed in or connected, a failure is shown as the error it was, and a sign-in Cloud rejected
  // is no longer offered for retry.
  const savedSignInRejected=snapshot.error===errorMessage({status:401});
  const savedSignInOffered=residentGate()&&!snapshot.cloudAccount&&snapshot.residentSavedCredential===true&&!savedSignInRejected;
  if(snapshot.purpose==='cloud-account')return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="cloud-account-title" tabIndex={-1} ref={panel}>
    <header><h1 id="cloud-account-title" className="serif">Eliza Cloud</h1><button aria-label="Close Cloud account" disabled={snapshot.busy} onClick={()=>connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    {!snapshot.cloudAccount&&<p>{savedSignInOffered?'Retry your saved connection or sign in again to use connected services such as Gmail.':'Sign in to use connected services such as Gmail.'}</p>}
    {savedSignInOffered&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button></div>}
    {cloudAccountControls}
    {snapshot.message&&<p role="status">{snapshot.message}</p>}{snapshot.error&&<p role="alert" className="alpha-connection-error">{residentGate()&&savedSignInRejected?'Your saved Cloud sign-in is no longer valid.':snapshot.error}</p>}
    {snapshot.busy&&<button className="alpha-connection-cancel" onClick={()=>connectionController.cancel()}>Cancel</button>}
  </div></div>;

  const residentKnownAccount=!!snapshot.cloudAccount||!!snapshot.residentSavedCredential;
  const residentSignInRequired=snapshot.residentSavedCredential===false||snapshot.error===errorMessage({status:401});
  const residentRestoring=snapshot.busy&&['Checking your Cloud account…','Starting the local agent…'].includes(snapshot.message);
  const residentNeedsPlan=snapshot.residentGate==='needs-plan'&&!!snapshot.cloudAccount&&!residentSignInRequired;
  const residentOffline=snapshot.residentGate==='offline'&&!snapshot.session;
  const planPanel=snapshot.purpose==='plan';
  // A check that ended without a view (identity or transport failure) is "unavailable", never a stale gate.
  const residentPlanView=snapshot.residentSubscription;
  const residentPlanUnchecked=!residentPlanView||residentPlanView.kind==='checking';
  const residentPlanDescribed=residentPlanUnchecked&&!snapshot.busy?{headline:'Plan status unavailable',detail:'Try again.',manage:false,manageLabel:''}:describeSubscription(residentPlanView);
  const residentPlan=residentNeedsPlan&&residentPlanView?.kind==='unavailable'&&residentPlanView.reason!=='not-published'
    ?{...residentPlanDescribed,detail:'Eliza Cloud could not confirm a plan for this account right now. Check again, redeem a subscription code or choose a plan. Your data on this phone is kept.'}:residentPlanDescribed;
  const residentPlanRecheck=residentPlanUnchecked||residentPlanView.kind==='inactive';
  const keyExpiresAt=snapshot.cloudAccount?.expiresAt;
  const keyExpiring=keyExpiresAt!==undefined&&keyExpiresAt-Date.now()<=CLOUD_KEY_EXPIRY_WARNING_MS;
  const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const residentHeading=residentRestoring?'Opening Alpha':residentSignInRequired&&residentKnownAccount?'Sign in to Eliza Cloud':residentOffline?'Offline':residentNeedsPlan?(residentPlanView?.kind==='inactive'&&residentPlanView.status==='canceled'?'Your plan has ended':'Choose a plan'):planPanel&&snapshot.cloudAccount?'Eliza Cloud account & plan':snapshot.cloudAccount?'Your Cloud account':residentKnownAccount?'Reconnect Eliza Cloud':'Welcome to Alpha';
  const redeemForm=<form className="alpha-connection-redeem" aria-label="Redeem a subscription code" onSubmit={event=>{event.preventDefault();const input=redeemCode.current;const value=input?.value||'';if(input)input.value='';void connectionController.residentRedeem(value);}}>
    <label>Subscription code<input ref={redeemCode} name="subscription-code" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={64} required disabled={snapshot.busy} placeholder="XXXX-XXXX-XXXX-XXXX"/></label>
    <button disabled={snapshot.busy}>Redeem code</button>
  </form>;
  if(residentGate())return <div className="alpha-connection-scrim"><div className={'alpha-connection alpha-connection-native'+(residentKnownAccount||residentRestoring?' alpha-connection-resume':'')} role="dialog" aria-modal="true" aria-labelledby="connection-title" aria-busy={residentRestoring||undefined} tabIndex={-1} ref={panel}>
    <header><h1 id="connection-title" className={residentKnownAccount||residentRestoring?'serif':undefined}>{residentHeading}</h1>{(snapshot.session||residentOffline)&&<button aria-label="Close connection settings" disabled={snapshot.busy} onClick={()=>connectionController.close()}>×</button>}</header>
    {!residentRestoring&&!residentOffline&&!residentNeedsPlan&&!(residentSignInRequired&&residentKnownAccount)&&<p>{snapshot.cloudAccount?'Your agent runs on this phone and uses your Eliza Cloud plan for AI.':residentKnownAccount?'Retry your saved connection or sign in again.':'Your agent runs on this phone. Sign in to Eliza Cloud to continue; Alpha Phone needs an account with a plan.'}</p>}
    {snapshot.cloudAccount&&!residentSignInRequired ? <>
      {(planPanel||residentNeedsPlan)&&<p>{snapshot.cloudAccount.email||`Account ${snapshot.cloudAccount.userId}`}</p>}
      <section aria-label="Eliza Cloud plan"><p><strong>{residentPlan.headline}</strong></p>{residentPlan.detail&&<p>{residentPlan.detail}</p>}{snapshot.planEndsAt&&!residentNeedsPlan?<p>Plan runs until {day(snapshot.planEndsAt)}.</p>:null}</section>
      {keyExpiring&&<section aria-label="Eliza Cloud sign-in"><p role="status">{keyExpiresAt<=Date.now()?'Your Eliza Cloud sign-in on this phone has expired.':`Your Eliza Cloud sign-in on this phone expires ${day(keyExpiresAt)}.`} Approve this phone again to keep AI available.</p>{!residentRestoring&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Approve this phone again</button>}</section>}
      {(residentNeedsPlan||planPanel)&&!residentRestoring&&redeemForm}
      {snapshot.redeemError&&<p role="alert" className="alpha-connection-error">{snapshot.redeemError}</p>}
      {snapshot.redeemNotice&&<p role="status">{snapshot.redeemNotice}</p>}
      {!residentRestoring&&<div className="alpha-connection-actions">
      {residentNeedsPlan?<button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{CHOOSE_PLAN_LABEL}</button>:(residentPlan.manage||planPanel)&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{residentPlan.manage?residentPlan.manageLabel:MANAGE_PLAN_LABEL}</button>}
      {planPanel&&snapshot.session?<button disabled={snapshot.busy} onClick={()=>connectionController.close()}>Done</button>:<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>{residentPlanRecheck||residentNeedsPlan?'Check plan again':'Continue'}</button>}
      <button disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Sign out</button>
      </div>}
    </>:!residentRestoring&&<div className={residentKnownAccount?'alpha-connection-actions':undefined}>
      {residentOffline&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Try again</button>}
      {snapshot.residentSavedCredential&&!residentSignInRequired&&!residentOffline&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button>}
      {!residentOffline&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Sign in with Eliza Cloud</button>}
    </div>}
    {conversations}
    {actionReview}
    {snapshot.replyNotice&&<p role="status">{snapshot.replyNotice}</p>}
    {snapshot.message&&<p role="status">{snapshot.message}</p>}
    {snapshot.error&&<p role="alert">{snapshot.error===errorMessage({status:401})?'Your saved Cloud sign-in is no longer valid.':snapshot.error}</p>}
    {snapshot.historyError&&<><p role="status">{snapshot.historyError}</p><button disabled={snapshot.busy} onClick={()=>void connectionController.retrySavedHistory()}>Retry saved conversation</button></>}
    {snapshot.busy&&<button className="alpha-connection-cancel" onClick={()=>connectionController.cancel()}>Cancel</button>}
    {testMocksEnabled&&residentQa()&&<p><button disabled={snapshot.busy} onClick={()=>connectionController.setResidentQa(null)}>Leave subscription gate QA ({residentEnvironment()})</button></p>}
  </div></div>;
  if(browserOnly)return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="local-only-title" tabIndex={-1} ref={panel}>
    <header><h1 id="local-only-title">Alpha Phone</h1><button aria-label="Close connection settings" onClick={()=>connectionController.close()}>Close</button></header>
    <p>Your agent runs locally in the Android app. Remote agents and pairing are unavailable.</p>
    <p>Local apps remain available here. Saved history is preserved.</p>
    <button onClick={()=>void connectionController.offline()}>Use local apps without AI</button>
  </div></div>;
  const pairingOptions=testMocksEnabled?<>
    <details><summary>Remote agent</summary><form onSubmit={event => { event.preventDefault(); void connectionController.pair('remote', remoteOrigin.current?.value || '', remoteCode.current?.value || ''); if (remoteCode.current) remoteCode.current.value = ''; }}>
      <label>Agent HTTPS address<input ref={remoteOrigin} type="url" autoCapitalize="none" spellCheck={false} placeholder="https://your-agent.example" required disabled={snapshot.busy} /></label>
      <label>Pairing code<input ref={remoteCode} autoComplete="off" autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" disabled={snapshot.busy} /></label><p>Use the code shown by your agent. Leave it empty to restore this phone’s saved session.</p><button disabled={snapshot.busy}>Connect remote agent</button>
    </form></details>
    {testMocksEnabled&&<details><summary>Local development agent</summary><p>For a development build connected to your computer. Inference still runs on your agent’s configured provider.</p><form onSubmit={event => { event.preventDefault(); void connectionController.pair('local', localOrigin.current?.value || '', localCode.current?.value || ''); if (localCode.current) localCode.current.value = ''; }}>
      <label>Local agent address<input ref={localOrigin} type="url" defaultValue="http://10.0.2.2:2138" autoCapitalize="none" spellCheck={false} required disabled={snapshot.busy} /></label>
      <label>Pairing code<input ref={localCode} autoComplete="off" autoCapitalize="characters" disabled={snapshot.busy} /></label><button disabled={snapshot.busy}>Connect local agent</button>
    </form></details>}
  </>:null;
  if(browserDevProfile)return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="connection-title" tabIndex={-1} ref={panel}>
    <header><h1 id="connection-title">Development connections</h1><button aria-label="Close connection settings" disabled={snapshot.busy} onClick={()=>connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    <p>Local profiles exercise agent setup, conversations and history. Edit the reply to test each consumer.</p>
    <label>Development profile<select aria-label="Development profile" value={developmentProfile} disabled={snapshot.busy} onChange={e=>{const next=e.target.value as DevelopmentProfile;if(next===developmentProfile)return;setReplyReady(false);setDevelopmentProfile(next);}}>{developmentProfiles.map(profile=><option key={profile} value={profile}>{developmentName(profile)}</option>)}</select></label>
    <label>Scripted reply<textarea rows={4} aria-label="Scripted reply" value={reply} maxLength={16000} disabled={snapshot.busy||!replyReady} onChange={e=>setReply(e.target.value)}/></label>
    <button disabled={snapshot.busy||!replyReady||!!developmentError} onClick={()=>void connectionController.saveDevelopment(developmentProfile,reply)}>Save development reply</button>
    <button disabled={snapshot.busy||!replyReady||!!developmentError} onClick={()=>void connectionController.startDevelopment(developmentProfile)}>Connect development profile</button>
    <button disabled={snapshot.busy} onClick={()=>recoverDevelopment('agent')}>Agent history recovery</button>
    <button disabled={snapshot.busy} onClick={()=>recoverDevelopment('execution')}>Execution history recovery</button>
    <button disabled={snapshot.busy} onClick={()=>recoverDevelopment('digest')}>Digest schedule recovery</button>
    {!isAndroid&&<button disabled={snapshot.busy} onClick={()=>void recoverConversationChoice()}>Conversation selection recovery</button>}
    {snapshot.session&&<section><strong>{snapshot.name}</strong><button disabled={snapshot.busy} onClick={()=>void connectionController.disconnect()}>Disconnect agent</button><button disabled={snapshot.busy} onClick={()=>void connectionController.listHistory()}>Load conversations</button>{snapshot.conversations.map(item=><section key={item.id}><span>{item.title}</span><button disabled={snapshot.busy} onClick={()=>void connectionController.restoreHistory(item.id)}>Restore conversation</button></section>)}</section>}
    {snapshot.session&&selection()?.kind==='development'&&<details><summary>Development device actions</summary><label>Action JSON<textarea rows={5} aria-label="Action JSON" value={developmentAction} disabled={snapshot.busy} onChange={e=>setDevelopmentAction(e.target.value)}/></label><button disabled={snapshot.busy} onClick={()=>{const selected=selection();if(selected?.kind==='development')void connectionController.authorDevelopment(selected.profile,developmentAction);}}>Queue action for review</button><button disabled={snapshot.busy} onClick={()=>void connectionController.actionHistory()}>Refresh actions</button><button disabled={snapshot.busy} onClick={()=>void connectionController.actionHistory(true)}>Sync recorded receipts</button>{snapshot.actionHistory.map(item=><section key={item.id}><p>{item.description}</p><span>{item.state}</span>{item.state==='pending'&&<button disabled={snapshot.busy} onClick={()=>void connectionController.rejectAction(item.id)}>Reject proposal</button>}{['executing','reconciliation_required'].includes(item.state)&&<><button disabled={snapshot.busy} onClick={()=>void connectionController.reconcileAction(item.id,'applied')}>I verified it happened</button><button disabled={snapshot.busy} onClick={()=>void connectionController.reconcileAction(item.id,'not_applied')}>I verified it did not happen</button></>}</section>)}</details>}
    <p><a href="?mode=dev&workflows=agent&start=workflows">Agent workflows</a> · <a href="?mode=dev&start=workflows">Device workflows</a></p>
    <DevelopmentCloudSetup connect={()=>connectionController.startDevelopment('cloud')}/>
    {pairingOptions}
    {browserLocalAgentEnabled&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Start local agent</button>}
    <button disabled={snapshot.busy} onClick={()=>void connectionController.offline()}>Continue offline</button>
    <p role="status">{snapshot.message}</p>{(snapshot.error||developmentError)&&<p role="alert">{snapshot.error||developmentError}</p>}{snapshot.busy&&<button onClick={()=>connectionController.cancel()}>Cancel</button>}
  </div></div>;
  // A production browser build has no on-device agent; say so instead of offering one.
  return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="connection-title" tabIndex={-1} ref={panel}>
    <header><span className="alpha-connection-logo alpha-compute-mark" aria-label="Alpha Compute"/><button aria-label="Close connection settings" disabled={snapshot.busy} onClick={() => connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    <h1 id="connection-title" className="serif">Your agent.<br />Your phone.</h1>
    <p>{browserOnly ? 'Connect your own remote agent, or continue offline.' : 'Run your agent locally, or connect an optional remote agent.'} Model inference uses the provider configured for that agent.</p>
    {browserOnly ? <section className="alpha-connection-notice"><h3>On-device agent unavailable here</h3>
      <p>The web version of Alpha Phone does not run an agent itself. Connect your own remote agent, or continue offline with local apps such as Notes and Calendar.</p>
    </section> : <section><h3>{isAndroid ? 'On-device agent' : 'Agent on this computer'}</h3>
      <p>{isAndroid ? 'Agent execution and state stay on this Android device. Hosted inference, when configured, receives your prompts and selected context.' : 'The agent runs on your development computer. This preview connects to it; the Android app runs its own agent.'}</p>
      {isAndroid && localPackaging==='available' && <details onToggle={event=>{if((event.currentTarget as HTMLDetailsElement).open)void connectionController.refreshProviderStatus();}}><summary>Model provider</summary><p role="status">{providerStatusLabel(snapshot.providerStatus)}</p><p>Cerebras receives prompts and selected context for inference with {LOCAL_PROVIDER_MODEL}. Your key is checked with Cerebras, then stored using Android Keystore. A new key takes effect after the agent restarts.</p><form onSubmit={event=>{event.preventDefault();const key=providerKey.current?.value||'';if(providerKey.current)providerKey.current.value='';void connectionController.configureLocal(key);}}><label>Cerebras API key<input ref={providerKey} type="password" autoComplete="off" required disabled={snapshot.busy}/></label><p>Model: {LOCAL_PROVIDER_MODEL}</p><button disabled={snapshot.busy}>Save provider</button></form>
        {snapshot.providerStatus?.configured&&snapshot.providerStatus.provider==='cerebras'&&(confirmRemove?<><p role="alert">Remove the saved Cerebras key from this phone? The local agent stops and cannot start again until you add a key.</p><button disabled={snapshot.busy} onClick={()=>{setConfirmRemove(false);void connectionController.removeProvider();}}>Remove key</button><button disabled={snapshot.busy} onClick={()=>setConfirmRemove(false)}>Keep key</button></>:<button disabled={snapshot.busy} onClick={()=>setConfirmRemove(true)}>Remove key…</button>)}</details>}
      <button disabled={snapshot.busy || localPackaging!=='available'} onClick={() => void connectionController.startLocal()}>Start local agent</button>
      {localPackaging==='checking' && <p role="status">Checking local agent availability…</p>}
      {localPackaging==='unavailable' && <p>The local agent is unavailable in this version. Connect a remote agent, sign in with Eliza Cloud, or continue offline.</p>}
    </section>}
    {snapshot.session && <section className="alpha-connection-current"><strong>{snapshot.name}</strong><span>Connected · {snapshot.kind === 'cloud' ? 'Eliza Cloud' : snapshot.kind === 'resident' ? (isAndroid ? 'On this device' : 'On this computer · development') : snapshot.kind === 'local' ? 'Local development' : 'Remote agent'}</span><button disabled={snapshot.busy} onClick={() => void connectionController.disconnect()}>Disconnect agent</button>{isAndroid && snapshot.kind==='resident' && <button disabled={snapshot.busy} onClick={()=>void connectionController.stopLocal()}>Stop local agent</button>}</section>}
    {!isAndroid&&<button disabled={snapshot.busy} onClick={()=>void recoverConversationChoice()}>Conversation selection recovery</button>}
    {conversations}
    {snapshot.session && snapshot.phoneCapabilityReason && <p role="status">{snapshot.phoneCapabilityReason}</p>}
    {actionReview}
    {snapshot.replyNotice && <p role="status">{snapshot.replyNotice}</p>}
    <div role="status" aria-live="polite">{snapshot.message}</div>
    {snapshot.error && <p role="alert" className="alpha-connection-error">{snapshot.error}</p>}
    {snapshot.busy && <button className="alpha-connection-cancel" onClick={() => connectionController.cancel()}>{snapshot.cloudPersonal?.view?'Stop waiting':'Cancel'}</button>}
    {testMocksEnabled&&<details><summary>Development Cloud agent infrastructure</summary><p>Connect your personal Eliza. Dedicated hosting requires a reviewed setup before it starts.</p>
      {cloudAccountControls}
      {!browserOnly&&<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudList(env())}>Refresh agent status</button>}
      {snapshot.cloudAccount&&Capacitor.getPlatform()!=='android'&&<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudPersonalRecovery()}>Cloud setup intent recovery</button>}
      {snapshot.cloudPersonal&&<CloudPersonalSetup setup={snapshot.cloudPersonal} busy={snapshot.busy} onAccept={()=>void connectionController.cloudPersonalAccept()} onDecline={()=>connectionController.cloudPersonalDecline()} onPoll={()=>void connectionController.cloudPersonalPoll()} onFinalize={()=>void connectionController.cloudPersonalFinalize()} onConnect={()=>void connectionController.cloudPersonalConnect()}/>}
      <button disabled={snapshot.busy} onClick={()=>void connectionController.cloudManage(env())}>Manage Cloud account</button>
    </details>}
    {pairingOptions}
    {testMocksEnabled&&<details><summary>Subscription gate QA</summary><p>Run the production Eliza Cloud sign-in and plan gate (sign-in, plan check, Redeem code, Choose a plan) against the chosen environment. Staging stops at plan admission; the on-device agent's inference binding is production-only.</p><label>Gate environment<select aria-label="Gate environment" ref={qaEnvironment} defaultValue="staging" disabled={snapshot.busy}><option value="staging">Staging</option><option value="production">Production</option></select></label><button disabled={snapshot.busy} onClick={()=>connectionController.setResidentQa(qaEnvironment.current?.value==='production'?'production':'staging')}>Start subscription gate QA</button></details>}
    {testMocksEnabled&&<details><summary>Mock mode</summary><p>Explore the prototype with simulated data and actions. No live agent connection is used.</p><button disabled={snapshot.busy} onClick={() => connectionController.mock()}>Enter mock mode</button></details>}
    <button className="alpha-connection-offline" disabled={snapshot.busy} onClick={() => void connectionController.offline()}>Continue offline</button>
  </div></div>;
}
