/** Display only. Stored messages, proposals and journal receipts are never rewritten. */
type Message = Record<string, any>;
const REVIEW_TEXT = 'Review this request on your phone before it can run.';
export function browserNavigationSummary(url: string): string {
  const destination = new URL(url);
  if (destination.protocol !== 'https:') throw Error('Expected an HTTPS destination');
  return `Opened ${destination.host}.`;
}
function cardDestination(message: Message): string | undefined {
  if (message.from !== 'agent' || !message.card?.proposalId || typeof message.text !== 'string') return;
  const prefix = 'Open browser destination ';
  if (!message.text.startsWith(prefix)) return;
  const url = message.text.slice(prefix.length);
  try { if (new URL(url).protocol === 'https:') return url; } catch { /* Keep unrecognized content intact. */ }
}
export function projectActionMessages(rendered: Message[], source: Message[]): Message[] {
  const byId = new Map(source.map(message => [message.id, message]));
  const hidden = new Set<string>();
  let turn: Message[] = [];
  const finish = () => {
    const actions = turn.filter(message => message.from === 'agent' && (message.card?.proposalId || message.deviceReceipt));
    if (!actions.length) return;
    for (const message of turn) if (message.from === 'agent' && message.text === REVIEW_TEXT) hidden.add(message.id);
    for (const action of actions) {
      if (!action.card?.done || typeof action.card.sub !== 'string') continue;
      const index = turn.indexOf(action);
      // Only the exact following receipt of this resolved proposal is redundant.
      const following = turn[index + 1];
      if (following?.from === 'agent' && following.deviceReceipt === true && following.id === `device-receipt:${action.card.proposalId}` && !following.card && following.text === action.card.sub) hidden.add(following.id);
    }
  };
  for (const message of source) { if (message.from === 'user') { finish(); turn = []; } turn.push(message); } finish();
  return rendered.filter(message => !hidden.has(message.id)).map(message => {
    const stored = byId.get(message.id);
    if (!stored || stored.from !== 'agent') return message;
    const destination = cardDestination(stored);
    if (stored.card?.proposalId && stored.card.done) {
      const displayText = destination && stored.card.title === 'Completed' ? browserNavigationSummary(destination) : stored.card.sub;
      if (typeof displayText !== 'string' || !displayText.trim()) return message;
      return {...message, cGeneric:false, cDigest:false, displayText, hasCalendarText:true};
    }
    if (stored.deviceReceipt && stored.browserDestination) {
      try { return {...message, displayText:browserNavigationSummary(stored.browserDestination), hasCalendarText:true}; } catch { return message; }
    }
    if (destination && message.cDigest && message.rows?.length) {
      return {...message,hasCalendarText:false,rows:message.rows.map((row:Message,index:number)=>index===0?{...row,who:`Open ${new URL(destination).host}?`,text:'Open in Browser.'}:row)};
    }
    return message;
  });
}
