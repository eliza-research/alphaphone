import React,{useRef,useState} from 'react';
import './cloud-membership-ui.css';
export type MembershipBalance='checking'|'zero'|'funded'|'member'|'unavailable';
import type {SubscriptionView} from './subscription-entitlement';
function creditLabel(usd:string):string {
 const [whole,fraction='']=usd.split('.');
 return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction.padEnd(2,'0')} USD`;
}
function endLabel(endsAt:number):string {
 const date=new Date(endsAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 const days=Math.ceil((endsAt-Date.now())/86400000);
 return days>0?`Ends ${date} · ${days} ${days===1?'day':'days'} left`:`Ended ${date}`;
}
/** Same account and membership controls in onboarding and Settings; only verified facts are displayed. */
export function CloudMembershipControls({balance,busy,error,notice,email,credits,plan,endsAt,onRedeem,onAddFunds,onRefresh}:{balance:MembershipBalance;busy:boolean;error?:string;notice?:string;email?:string;credits?:{usd:string;observedAt:number}|null;plan?:SubscriptionView|null;endsAt?:number|null;onRedeem:(code:string)=>Promise<boolean>;onAddFunds:()=>void;onRefresh:()=>void}){
 const code=useRef<HTMLInputElement>(null);
 const active=plan?.kind==='active';
 return <section className="alpha-membership" aria-label="Membership and credits">
   <dl className="alpha-membership-facts">
    <div><dt>Account</dt><dd>{email||'Signed in to Eliza Cloud'}</dd></div>
    <div><dt>Available credits</dt><dd>{credits?creditLabel(credits.usd):balance==='checking'?'Checking…':'Not available'}{credits&&<small>Checked {new Date(credits.observedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</small>}</dd></div>
    <div><dt>Membership</dt><dd>{active?plan.planName:plan?.kind==='inactive'?'No active membership':plan?.kind==='credits'?'No active membership':balance==='checking'?'Checking…':'Not confirmed'}{active&&<small>{typeof endsAt==='number'&&Number.isFinite(endsAt)?endLabel(endsAt):'End date not provided'}</small>}</dd></div>
   </dl>
   <p role="status">{balance==='checking'?'Checking your account…':balance==='unavailable'?'Account details could not be refreshed. You can still redeem a code or check again.':balance==='zero'?'Use a membership code or add funds to ask Alpha.':''}</p>
   <form aria-label="Redeem a membership code" onSubmit={event=>{event.preventDefault();const input=code.current;if(!input)return;void onRedeem(input.value).then(ok=>{if(ok&&code.current)code.current.value='';});}}>
     <label>Membership code<input ref={code} name="membership-code" autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-autofill-ignore="true" maxLength={64} disabled={busy} required aria-invalid={!!error||undefined}/></label>
     <button type="submit" disabled={busy}>Redeem code</button>
   </form>
   <div className="alpha-membership-actions"><button type="button" disabled={busy} onClick={onAddFunds}>Add funds</button><button type="button" disabled={busy||balance==='checking'} onClick={onRefresh}>Check balance</button></div>
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}

/** Acknowledgment is not proof of the external browser session; the owner must check it there. */
export function BillingAccountReview({email,busy,error,onOpen,onCancel}:{email:string;busy:boolean;error?:string;onOpen:()=>void;onCancel:()=>void}){
 const [acknowledged,setAcknowledged]=useState(false);
 return <section className="alpha-billing-review"><header><h1 className="serif">Check the billing account</h1></header><p>Alpha is signed in as <strong>{email}</strong>.</p><p>Your browser may be signed into a different account. Before paying, use the billing page’s account menu to check it shows <strong>{email}</strong>. Funds go to the account shown there.</p><form onSubmit={event=>{event.preventDefault();if(acknowledged&&!busy)onOpen();}}><label><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy} required/>I’ll check the account before paying.</label><div className="alpha-membership-actions"><button type="submit" disabled={!acknowledged||busy}>Open billing</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></form>{error&&<p role="alert">{error}</p>}</section>;
}
