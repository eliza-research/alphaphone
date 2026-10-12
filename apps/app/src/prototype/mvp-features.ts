import { browserDevProfile } from '../browser/dev-profile';
// Approved October 12 scope: docs/implementation-plan.md and issue #422.
// Wallet is removed from MVP, including AOSP: no payment/provider activation.
// Phone/SMS/Contacts remain gated pending the separately approved AOSP-only implementation.
// Reference definitions and saved user data are retained; development fixtures are non-product.
export const ENABLED_MVP_VIEWS = new Set([
  // "phone", // Deferred: September 15 notes, calls/SMS/Contacts deprioritized.
  // "messages", // Deferred: SMS UI; this does not defer email/Telegram/Discord.
  "inbox", "calendar", "browser", "camera", "photos", "maps", "notes",
  // "contacts", // Deferred: no directory access or Contacts adapter effects.
  "files",
  // "wallet", // Removed from MVP in both distributions and AOSP; no payment flow.
  "workflows", "settings",
]);
export const DEFERRED_MVP_VIEWS = new Set(["phone", "messages", "contacts", "wallet"]);
// Development-server fixtures only (browserDevProfile requires devSurfacesEnabled); never a product scope change.
if(browserDevProfile){for(const view of DEFERRED_MVP_VIEWS)ENABLED_MVP_VIEWS.add(view);DEFERRED_MVP_VIEWS.clear();}
export function isMvpView(view: string) { return ENABLED_MVP_VIEWS.has(view); }
export function deferredMvpPrompt(text: unknown) {
  return /^(?:(?:open|show|go to|launch)\s+(?:the\s+)?(?:phone|dialer|sms|messages|contacts|wallet)(?:\b)|(?:call|dial|text|sms|pay)\b|(?:send|write)\s+(?:an?\s+)?(?:sms|text message)\b)/i.test(String(text).trim());
}
