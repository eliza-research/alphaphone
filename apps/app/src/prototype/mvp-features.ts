import { browserDevProfile } from '../browser/dev-profile';
// Approved October 12 scope: docs/implementation-plan.md and issue #422.
// Wallet is removed from MVP, including AOSP: no payment/provider activation.
// #420: Phone/SMS/Contacts require an admitted Alpha AOSP image and real adapters.
// Contacts is admitted only by the native image capability; Phone/SMS adapters remain unavailable.
// Reference definitions and saved user data are retained; development fixtures are non-product.
export const ENABLED_MVP_VIEWS = new Set([
  // "phone", // AOSP-only; Telecom adapter pending.
  // "messages", // AOSP-only SMS adapter pending; email/Telegram/Discord are separate.
  "inbox", "calendar", "browser", "camera", "photos", "maps", "notes",
  // "contacts", // AOSP-only; Admitted dynamically by the image Contacts capability.
  "files",
  // "wallet", // Removed from MVP in both distributions and AOSP; no payment flow.
  "workflows", "settings",
]);
export const DEFERRED_MVP_VIEWS = new Set(["phone", "messages", "contacts", "wallet"]);
// Development-server fixtures only (browserDevProfile requires devSurfacesEnabled); never a product scope change.
if(browserDevProfile){for(const view of DEFERRED_MVP_VIEWS)ENABLED_MVP_VIEWS.add(view);DEFERRED_MVP_VIEWS.clear();}
export function isMvpView(view: string) { return ENABLED_MVP_VIEWS.has(view); }
export function deferredMvpPrompt(text: unknown) {
  if(isMvpView("contacts")&&/^(?:open|show|go to|launch)\s+(?:the\s+)?contacts\b/i.test(String(text).trim()))return false;
  return /^(?:(?:open|show|go to|launch)\s+(?:the\s+)?(?:phone|dialer|sms|messages|contacts|wallet)(?:\b)|(?:call|dial|text|sms|pay)\b|(?:send|write)\s+(?:an?\s+)?(?:sms|text message)\b)/i.test(String(text).trim());
}

/** Native image admission enables only implemented adapters; Phone/SMS remain unavailable. */
export function admitImageContacts(admitted:boolean){if(browserDevProfile)return;if(admitted){ENABLED_MVP_VIEWS.add("contacts");DEFERRED_MVP_VIEWS.delete("contacts");}else{ENABLED_MVP_VIEWS.delete("contacts");DEFERRED_MVP_VIEWS.add("contacts");}}
