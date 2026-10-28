import React,{useEffect,useRef,useState} from 'react';
import './cloud-membership-ui.css';
export type MembershipBalance='checking'|'zero'|'funded'|'member'|'unavailable';
import {subscriptionSummary,type ServiceLimit,type SubscriptionView} from './subscription-entitlement';
function creditLabel(usd:string):string {
 const [whole,fraction='']=usd.split('.');
 return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction.padEnd(2,'0')} USD`;
}
/** Milliseconds until a shown Cloud limit's text changes or lapses (between 1 s and 1 h), or null. */
function nextLimitChange(limit:ServiceLimit&{observedAt:number},now:number):number|null {
 const points=[limit.retryAfterMs!==null?limit.observedAt+limit.retryAfterMs:null,limit.resetsAt,limit.retryAfterMs===null&&limit.resetsAt===null?limit.observedAt+60_000:null]
  .filter((at):at is number=>at!==null&&at>now);
 return points.length?Math.min(3_600_000,Math.max(1000,Math.min(...points)-now)):null;
}
function endLabel(endsAt:number):string {
 const date=new Date(endsAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 const days=Math.ceil((endsAt-Date.now())/86400000);
 return days>0?`Ends ${date} · ${days} ${days===1?'day':'days'} left`:`Ended ${date}`;
}
/**
 * The account and plan section shared by onboarding and Settings (#410, P-26): the plan state, the
 * plan allowance Cloud reports, the plan end and the retry time of the latest Cloud limit, all from
 * the shared subscription summary. A credit balance appears only in Cloud's explicit
 * organization-credit mode, read-only. Nothing is bought here: the manage action opens Cloud's own
 * billing page after the account review.
 *
 * `planShownByHost`: the resident agent dialog already shows the account, the plan with its
 * allowance and end and the plan actions (choose or manage, Check plan again). There this section
 * adds only the credit balance, the latest Cloud limit, the code form and its result, so no fact or
 * action appears twice.
 */
export function CloudMembershipControls({balance,busy,error,notice,email,credits,plan,endsAt,lastLimit,serviceName='Cloud',planShownByHost=false,onRedeem,onManage,onRefresh}:{balance:MembershipBalance;busy:boolean;error?:string;notice?:string;email?:string;credits?:{usd:string;observedAt:number}|null;plan?:SubscriptionView|null;endsAt?:number|null;lastLimit?:(ServiceLimit&{observedAt:number})|null;serviceName?:string;planShownByHost?:boolean;onRedeem:(code:string)=>Promise<boolean>;onManage:()=>void;onRefresh:()=>void}){
 const code=useRef<HTMLInputElement>(null);
 const summary=subscriptionSummary(plan??(balance==='checking'?{kind:'checking'}:null),{planEndsAt:endsAt??null,lastLimit:lastLimit??null,lastLimitAt:lastLimit?.observedAt??null,serviceName});
 // Render again when the shown limit's wait ends or its reset passes, so a lapsed retry time is not
 // left on screen. Only those moments change the status line; it is not a per-second countdown.
 const [,tick]=useState(0);
 const limitChange=summary.limit&&lastLimit?nextLimitChange(lastLimit,Date.now()):null;
 useEffect(()=>{if(limitChange===null)return;const timer=setTimeout(()=>tick(value=>value+1),limitChange);return ()=>clearTimeout(timer);});
 const planEnd=typeof summary.planEndsAt==='number'&&Number.isFinite(summary.planEndsAt)?summary.planEndsAt:null;
 const facts=[
  !planShownByHost&&<div key="account"><dt>Account</dt><dd>{email||`Signed in to ${serviceName}`}</dd></div>,
  !planShownByHost&&<div key="plan"><dt>Plan</dt><dd>{plan?summary.headline:balance==='checking'?'Checking…':'Not confirmed'}{plan?.kind==='active'&&<small>{planEnd!==null?endLabel(planEnd):'End date not provided'}</small>}</dd></div>,
  !planShownByHost&&summary.allowance&&<div key="allowance"><dt>Plan allowance</dt><dd>{summary.allowance}</dd></div>,
  plan?.kind==='credits'&&<div key="credits"><dt>Credit balance</dt><dd>{credits?creditLabel(credits.usd):'Not available'}{credits&&<small>Checked {new Date(credits.observedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</small>}</dd></div>,
  summary.limit&&<div key="limit"><dt>AI requests</dt><dd role="status">{summary.limit}</dd></div>,
 ].filter(Boolean);
 return <section className="alpha-membership" aria-label="Plan and membership">
   {facts.length>0&&<dl className="alpha-membership-facts">{facts}</dl>}
   {!planShownByHost&&<p role="status">{balance==='checking'?'Checking your plan…':balance==='unavailable'?'Plan details could not be refreshed. You can still redeem a code or check again.':balance==='zero'?'Redeem a membership code or choose a plan to ask Alpha. Nothing is purchased automatically.':''}</p>}
   <form aria-label="Redeem a membership code" onSubmit={event=>{event.preventDefault();const input=code.current;if(!input)return;void onRedeem(input.value).then(ok=>{if(ok&&code.current)code.current.value='';});}}>
     <label>Membership code<input ref={code} name="membership-code" autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-autofill-ignore="true" maxLength={64} disabled={busy} required aria-invalid={!!error||undefined}/></label>
     <button type="submit" disabled={busy}>Redeem code</button>
   </form>
   {!planShownByHost&&<div className="alpha-membership-actions"><button type="button" disabled={busy} onClick={onManage}>{summary.manageLabel}</button><button type="button" disabled={busy||balance==='checking'} onClick={onRefresh}>Check plan again</button></div>}
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}

/** Acknowledgment is not proof of the external browser session; the owner must check it there. */
export function BillingAccountReview({email,busy,error,onOpen,onCancel}:{email:string;busy:boolean;error?:string;onOpen:()=>void;onCancel:()=>void}){
 const [acknowledged,setAcknowledged]=useState(false);
 return <section className="alpha-billing-review"><header><h1 className="serif">Check the billing account</h1></header><p>Alpha is signed in as <strong>{email}</strong>.</p><p>Your browser may be signed into a different account. Before paying, use the billing page’s account menu to check it shows <strong>{email}</strong>. A plan or payment there applies to the account shown.</p><form onSubmit={event=>{event.preventDefault();if(acknowledged&&!busy)onOpen();}}><label><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy} required/>I’ll check the account before paying.</label><div className="alpha-membership-actions"><button type="submit" disabled={!acknowledged||busy}>Open billing</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></form>{error&&<p role="alert">{error}</p>}</section>;
}
