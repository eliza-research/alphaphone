import { createInlineModal } from '../runtime/inline-modal';
import { connectionController } from '../runtime/connection-ui';
import type { EmailTarget } from './inbox-cloud-adapter';

type Shell = any;
type Review = { id: string; text: string; session: string; cloud: string; target: EmailTarget; notice: string; opener: HTMLElement | null };
const MAXIMUM = 64000;
/** Selected Files and Photos are never attached by a suggestion; the composer's picker stays the only way. */
export const USE_IN_EMAIL_ATTACHMENT_POLICY = 'Only this text is added. Files and photos are not attached; use Attach in the email to choose them.';

/** What the review tells the user about the destination. Pure, so the wording is tested without a renderer. */
export function describeEmailTarget(target: EmailTarget): { account: string; destination: string; effect: string; confirmLabel: string; blocked: boolean } {
  if (!target.ready) return { account: target.account ? `From ${target.account}` : '', destination: 'No email draft can take this suggestion yet.', effect: target.reason, confirmLabel: 'Insert into draft', blocked: true };
  const to = target.to.length ? target.to.join(', ') : 'no recipients yet';
  const subject = target.subject.trim() || '(no subject)';
  // The literal address comes first; the sender's display name is their own text and only follows it.
  const destination = target.kind === 'reply' ? (target.to.length ? `New reply to ${to}${target.from ? ` (${target.from})` : ''} · ${subject}` : `New reply · ${subject} · no recipients yet`)
    : target.kind === 'draft' ? `Your ${target.aside ? 'unfinished' : 'open'} ${target.reply ? 'reply' : 'email'} draft${target.aside ? ' (not on screen)' : ''} · ${subject} · to ${to}`
    : 'A new email. You add the recipients and subject.';
  const effect = target.append ? 'This draft already has text. The suggestion is added below it; nothing is replaced.' : target.kind === 'draft' ? 'The draft has no message text yet. The suggestion becomes its text.' : 'A local draft opens with this text for you to edit.';
  return { account: `From ${target.account || 'the selected Gmail account'}`, destination,
    // One draft exists per account: a set-aside draft takes the suggestion, not the message on screen.
    effect: target.kind === 'draft' && target.elsewhere ? `This is not a reply to the message on screen. ${effect}` : effect,
    confirmLabel: target.append ? 'Add below existing text' : 'Insert into draft', blocked: false };
}

/**
 * "Use in email" in the assistant conversation. An agent reply is offered for the email the user
 * has selected in Inbox; the review names the account and the exact draft or message, and the
 * insert is refused if any of them changed in the meantime. It only fills a local draft: sending
 * still requires the composer and the provider review.
 */
export function installUseInEmailReview(Component: Shell, views: Record<string, Shell>) {
  const p = Component.prototype, original = p.renderVals, unmount = p.componentWillUnmount;
  const reviews = new WeakMap<object, Review>(), modals = new WeakMap<object, ReturnType<typeof createInlineModal>>();
  const refresh = (shell: Shell) => { if (shell.live !== false) shell.setState({ emailUseRevision: Date.now() }); };
  const agentSession = () => JSON.stringify(connectionController.getSnapshot().session ?? null);
  const cloudSession = () => connectionController.getCloudClient()?.sessionId || '';
  const target = (): EmailTarget => typeof views.inbox?.emailTarget === 'function' ? views.inbox.emailTarget() : { ready: false, reason: 'Inbox is unavailable. Nothing was added.', token: '' };
  const eligible = (entry: Shell) => !!entry && entry.from === 'agent' && !entry.card && !entry.streaming && !entry.interrupted && typeof entry.id === 'string' && typeof entry.text === 'string' && !!entry.text.trim();
  const close = (shell: Shell) => { if (reviews.delete(shell)) refresh(shell); };
  /** The review names an account, recipients and a subject: it does not outlive a locked or sleeping phone. */
  const unlocked = (state: Shell) => (state.screen ?? 'home') === 'home';
  /** A destination that cannot hold the whole reply is blocked in the review; text is never cut short. */
  const fit = (found: EmailTarget, text: string): EmailTarget => !found.ready ? found
    : text.length > MAXIMUM ? { ...found, ready: false, reason: 'This reply is longer than an email draft can hold. Copy the part you need instead.' }
    : text.length > found.room ? { ...found, ready: false, reason: 'The open draft does not have room for this whole reply. Copy the part you need instead. Nothing was added.' } : found;
  function open(shell: Shell, entry: Shell) {
    if (shell.S().view !== 'inbox' || !unlocked(shell.S()) || !eligible(entry)) return;
    // Focus returns to the reply itself: its actions menu may close while the review is open.
    reviews.set(shell, { id: entry.id, text: entry.text, session: agentSession(), cloud: cloudSession(), opener: document.querySelector<HTMLElement>(`[data-alpha-message-id="${CSS.escape(entry.id)}"] [data-alpha-message-text]`),
      target: fit(target(), entry.text), notice: '' });
    refresh(shell);
  }
  function confirm(shell: Shell) {
    const review = reviews.get(shell); if (!review || !review.target.ready) return;
    const fail = (notice: string) => { review.target = fit(target(), review.text); review.notice = notice; refresh(shell); };
    // The reply must still be the one on screen, from the same agent conversation, over the same Inbox.
    const message = (shell.S().msgs || []).find((row: Shell) => row.id === review.id);
    if (!eligible(message) || message.text !== review.text || review.session !== agentSession()) { reviews.delete(shell); shell.toast?.('The conversation changed. Nothing was added to an email.'); refresh(shell); return; }
    if (shell.S().view !== 'inbox' || !unlocked(shell.S()) || document.hidden || connectionController.getSnapshot().open) { fail('Inbox is no longer in front. Nothing was added.'); return; }
    if (review.cloud !== cloudSession()) { fail('The Cloud account changed. Check the destination and confirm again. Nothing was added.'); return; }
    const inserted = views.inbox.useInEmail?.(review.text, { token: review.target.token, append: review.target.append }) === true;
    if (!inserted) { fail('The email or account changed since you opened this review. Check the destination and confirm again. Nothing was added.'); return; }
    reviews.delete(shell);
    // Show the composer holding the suggestion; the conversation stays available from the pill.
    shell.setState({ chat: 'hidden', emailUseRevision: Date.now() });
  }
  p.renderVals = function () {
    const out = original.call(this), state = this.S(), source = state.msgs || [];
    const inInbox = state.view === 'inbox' && typeof views.inbox?.useInEmail === 'function';
    let review = reviews.get(this);
    // Leaving Inbox or the conversation, locking the phone, or losing the reply ends the review without inserting.
    if (review && (!inInbox || !unlocked(state) || !['sheet', 'full'].includes(state.chat) || !source.some((row: Shell) => row.id === review!.id && row.text === review!.text))) { reviews.delete(this); review = undefined; }
    out.msgs = (out.msgs || []).map((message: Shell, index: number) => {
      const entry = source[index];
      if (!inInbox || !message.messageActionsRole || !eligible(entry) || entry.text !== message.text) return message;
      // The actions menu closes as the review opens; closing the review returns focus to the reply.
      return { ...message, canUseInEmail: true, useInEmail: () => { message.closeMessageActions?.({ detail: 1 }); open(this, entry); } };
    });
    let modal = modals.get(this);
    if (!modal) { modal = createInlineModal(() => close(this), () => reviews.get(this)?.opener || null); modals.set(this, modal); }
    out.emailUseOpen = !!review; out.emailUseModal = modal.ref;
    out.emailUse = review ? { ...describeEmailTarget(review.target), text: review.text, notice: review.notice, policy: USE_IN_EMAIL_ATTACHMENT_POLICY,
      confirm: () => confirm(this), close: () => close(this) } : null;
    return out;
  };
  p.componentWillUnmount = function (...args: unknown[]) { reviews.delete(this); modals.delete(this); return unmount?.apply(this, args); };
}
