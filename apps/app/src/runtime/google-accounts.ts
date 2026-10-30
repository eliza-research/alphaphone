import {retireGmailBackground} from './gmail-background';
import type {GmailAccount} from './cloud-protocol';
import {disconnectGmailAccount, type GmailDisconnectOutcome} from './gmail-mailbox';

/** A Google grant can authorize Gmail and Calendar together. Never call this account deletion. */
export const GOOGLE_ACCOUNTS_CHANGED = 'alpha:google-accounts-changed';

export interface GoogleAccountsClient {
  initiateGoogle(signal: AbortSignal, calendarPermission?: 'read' | 'write', gmailPermission?: 'read' | 'modify' | 'send' | 'drafts' | 'mailbox'): Promise<string>;
  initiateGoogleWithReturn?(signal:AbortSignal,redirectUrl:string,calendarPermission?:'read'|'write',gmailPermission?:'read'|'modify'|'send'|'drafts'|'mailbox'):Promise<{authUrl:string;appReturn:boolean}>;
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]>;
  disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void>;
}
export interface GoogleAccountsBinding {
  client: GoogleAccountsClient;
  sessionId: string;
  credentialId: string;
}

export function notifyGoogleAccountsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GOOGLE_ACCOUNTS_CHANGED));
}

export function googleDisconnectConfirmation(label: string, serviceName = 'Cloud'): string {
  return `Disconnect ${label} from Alpha Phone?\n\nThis removes ${serviceName}'s stored Google connection, including Gmail and Calendar access granted through it. Your Google account, mail and calendar events are not deleted. Local drafts stay in this app until you discard them.`;
}

export function googleDisconnectMessage(outcome: GmailDisconnectOutcome, label: string, serviceName = 'Cloud'): string {
  if (outcome === 'disconnected') return `${label} is disconnected from Alpha. ${serviceName} no longer holds this Google connection's Gmail or Calendar access. Your Google account, mail and events were not deleted; local drafts stay in this app. Google may still list the app in your Google Account permissions.`;
  if (outcome === 'still-connected') return `Disconnect was requested, but Google still reports ${label} as connected to Alpha. Check the connection again.`;
  return `Disconnect of ${label} was not confirmed. Check the connection before trying again.`;
}

/** One captured Cloud session owns every request and result. Recreate after an account change. */
export function createGoogleAccounts(
  binding: GoogleAccountsBinding,
  current: () => GoogleAccountsBinding | null,
  changed: () => void = notifyGoogleAccountsChanged,
) {
  const {client, sessionId, credentialId} = binding;
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    const live = current();
    if (!live || live.client !== client || live.sessionId !== sessionId || live.credentialId !== credentialId) {
      throw new DOMException('The Cloud account changed. Check Google connections again.', 'AbortError');
    }
  };
  return {
    async list(signal: AbortSignal): Promise<GmailAccount[]> {
      check(signal);
      const accounts = await client.gmailAccounts(signal);
      check(signal);
      return accounts;
    },
    /** Returns the authorization URL only; authorization completion must be checked with list. */
    async connect(signal: AbortSignal, calendarPermission: 'read' | 'write' = 'read', gmailPermission: 'read' | 'modify' | 'send' | 'drafts' | 'mailbox' = 'read'): Promise<string> {
      check(signal);
      const url = await client.initiateGoogle(signal, calendarPermission, gmailPermission);
      check(signal);
      return url;
    },
    async connectWithReturn(signal:AbortSignal,redirectUrl:string,calendarPermission:'read'|'write'='read',gmailPermission:'read'|'modify'|'send'|'drafts'|'mailbox'='read') {
      check(signal);
      const result=client.initiateGoogleWithReturn?await client.initiateGoogleWithReturn(signal,redirectUrl,calendarPermission,gmailPermission):{authUrl:await client.initiateGoogle(signal,calendarPermission,gmailPermission),appReturn:false};
      check(signal);return result;
    },
    /** Caller owns confirmation. Reuse Gmail's one-request, read-back-verified grant revocation. */
    async disconnect(connectionId: string, signal: AbortSignal) {
      check(signal);
      if (!connectionId.trim()) throw new TypeError('Choose a Google connection to disconnect.');
      // Start retiring native callbacks/notices first, but never let local bookkeeping
      // delay or block the privacy-relevant remote revoke on this captured binding.
      const retirement = retireGmailBackground(connectionId);
      try {
        const result = await disconnectGmailAccount({
          async disconnectGmail(id, requestSignal) {
            check(requestSignal);
            await client.disconnectGmail(id, requestSignal);
            check(requestSignal);
          },
          async gmailAccounts(requestSignal) {
            check(requestSignal);
            const accounts = await client.gmailAccounts(requestSignal);
            check(requestSignal);
            return accounts;
          },
        }, connectionId, signal);
        check(signal);
        // Even an uncertain mutation needs a fresh account read on the other surfaces.
        changed();
        return result;
      } finally { await retirement.settled(); }
    },
  };
}
