import { browserDevProfile } from '../browser/dev-profile';
// Full-product scope: docs/full-product-completion-audit.md FP-01 through FP-04.
// The user included Phone, SMS, Contacts and Wallet on October 11. They stay
// disabled until their native capabilities, permission/role recovery, recipient
// review and return-to-HOME flows are implemented and accepted. Wallet also needs
// the chosen provider/security contract and payment acceptance.
// Reference definitions, template, assets and saved user data are deliberately retained.
export const ENABLED_MVP_VIEWS = new Set([
  // "phone", // Pending native calling implementation and acceptance.
  // "messages", // Pending SMS implementation; email/Telegram/Discord have separate scope.
  "inbox", "calendar", "browser", "camera", "photos", "maps", "notes",
  // "contacts", // Pending Contacts permission and directory implementation.
  "files",
  // "wallet", // Pending provider/security decisions and real payment flow.
  "workflows", "settings",
]);
export const DEFERRED_MVP_VIEWS = new Set(["phone", "messages", "contacts", "wallet"]);
// Development-server fixtures only (browserDevProfile requires devSurfacesEnabled); never a product scope change.
if(browserDevProfile){for(const view of DEFERRED_MVP_VIEWS)ENABLED_MVP_VIEWS.add(view);DEFERRED_MVP_VIEWS.clear();}
export function isMvpView(view: string) { return ENABLED_MVP_VIEWS.has(view); }
export function deferredMvpPrompt(text: unknown) {
  return /^(?:(?:open|show|go to|launch)\s+(?:the\s+)?(?:phone|dialer|sms|messages|contacts|wallet)(?:\b)|(?:call|dial|text|sms|pay)\b|(?:send|write)\s+(?:an?\s+)?(?:sms|text message)\b)/i.test(String(text).trim());
}
