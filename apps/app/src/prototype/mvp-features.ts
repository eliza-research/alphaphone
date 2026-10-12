import { browserDevProfile } from '../browser/dev-profile';
// Full-product scope: docs/full-product-completion-audit.md FP-01 through FP-04.
// October 12 P-36 limits Phone/SMS/Contacts to admitted Alpha AOSP images;
// native capabilities, roles, recipient review and recovery remain unimplemented.
// Wallet stays a full-product planning package outside MVP (P-38).
// Reference definitions, template, assets and saved user data are deliberately retained.
export const ENABLED_MVP_VIEWS = new Set([
  // "phone", // Pending native calling implementation and acceptance.
  // "messages", // Pending SMS implementation; email/Telegram/Discord have separate scope.
  "inbox", "calendar", "browser", "camera", "photos", "maps", "notes",
  // "contacts", // Pending Contacts permission and directory implementation.
  "files",
  // "wallet", // Removed from MVP; full-product planning remains FP-04.
  "workflows", "settings",
]);
export const DEFERRED_MVP_VIEWS = new Set(["phone", "messages", "contacts", "wallet"]);
// Development-server fixtures only (browserDevProfile requires devSurfacesEnabled); never a product scope change.
if(browserDevProfile){for(const view of DEFERRED_MVP_VIEWS)ENABLED_MVP_VIEWS.add(view);DEFERRED_MVP_VIEWS.clear();}
export function isMvpView(view: string) { return ENABLED_MVP_VIEWS.has(view); }
export function deferredMvpPrompt(text: unknown) {
  return /^(?:(?:open|show|go to|launch)\s+(?:the\s+)?(?:phone|dialer|sms|messages|contacts|wallet)(?:\b)|(?:call|dial|text|sms|pay)\b|(?:send|write)\s+(?:an?\s+)?(?:sms|text message)\b)/i.test(String(text).trim());
}
