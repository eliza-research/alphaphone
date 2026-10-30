import { browserDevProfile } from '../browser/dev-profile';
import { admittedAospViews, aospImage } from '../runtime/aosp-image';
import {mobileViewIsAvailable, type MobileViewPolicyPage} from '@elizaos/ui/mobile-shell/core';
// Compatibility projection of actual registered host implementations. The same
// shared policy drives the common catalog and negotiated agent view profile.
const implementations=new Map<string,MobileViewPolicyPage & {implemented:boolean}>();
const IMAGE_VIEWS=new Set(admittedAospViews(aospImage));
export const ENABLED_MVP_VIEWS=new Set<string>();
export const DEFERRED_MVP_VIEWS=new Set<string>();
function recompute(){
 ENABLED_MVP_VIEWS.clear();DEFERRED_MVP_VIEWS.clear();
 for(const [id,page] of implementations){
  if(mobileViewIsAvailable(page,{implemented:page.implemented,managedCloud:false,nativeViews:browserDevProfile?new Set(['phone','messages','contacts']):IMAGE_VIEWS,developer:browserDevProfile,preview:browserDevProfile}))ENABLED_MVP_VIEWS.add(id);
  else DEFERRED_MVP_VIEWS.add(id);
 }
}
export function registerMobileCompatibilityView(id:string,implemented=true,metadata:Pick<MobileViewPolicyPage,'availability'|'viewKind'>={}){implementations.set(id,{id,availability:metadata.availability,viewKind:metadata.viewKind,implemented:implemented||browserDevProfile});recompute();}
export function isMvpView(view:string){return ENABLED_MVP_VIEWS.has(view);}
const PROMPT_VIEWS: Record<string, string> = { phone: "phone", dialer: "phone", call: "phone", dial: "phone", sms: "messages", messages: "messages", text: "messages", "text message": "messages", contacts: "contacts" };
const UNAVAILABLE_PROMPT = /^(?:(?:open|show|go to|launch)\s+(?:the\s+)?(phone|dialer|sms|messages|contacts|wallet)(?:\b)|(call|dial|text|sms|pay)\b|(?:send|write)\s+(?:an?\s+)?(sms|text message)\b)/i;
/** True when a local quick command names an app that is unavailable in this install. A telephony
 * command passes only on the verified image where its view is admitted (development fixtures never
 * admit one); Unimplemented Wallet and payment shortcuts remain unavailable. */
export function deferredMvpPrompt(text: unknown) {
  const match = UNAVAILABLE_PROMPT.exec(String(text).trim());
  if (!match) return false;
  const view = PROMPT_VIEWS[(match[1] || match[2] || match[3] || "").toLowerCase()];
  return !view || !(view === "contacts" ? !browserDevProfile && isMvpView("contacts") : IMAGE_VIEWS.has(view));
}

/** Native Contacts admission changes only the installed adapter fact. */
export function admitImageContacts(admitted:boolean){if(browserDevProfile)return;if(admitted&&aospImage)IMAGE_VIEWS.add('contacts');else IMAGE_VIEWS.delete('contacts');recompute();}
