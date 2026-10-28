import React,{useEffect,useId,useRef,useState} from 'react';
import './cloud-membership-ui.css';
export type MembershipBalance='checking'|'zero'|'funded'|'member'|'unavailable';
import type {SubscriptionView} from './subscription-entitlement';
function creditLabel(usd:string):string {
 const [whole,fraction='']=usd.split('.');
 return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction.replace(/0+$/,'').padEnd(2,'0')}`;
}
function endLabel(endsAt:number):string {
 const date=new Date(endsAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 const days=Math.ceil((endsAt-Date.now())/86400000);
 return days>0?`Ends ${date} · ${days} ${days===1?'day':'days'} left`:`Ended ${date}`;
}
/** Approved bottom-sheet content; balances and actions remain bound to the current Cloud account. */
export function CloudMembershipControls({balance,busy,error,connectionError,notice,email,credits,plan,endsAt,codeEntry=false,onRedeem,onAddFunds,onRefresh}:{balance:MembershipBalance;busy:boolean;error?:string;connectionError?:string;notice?:string;email?:string;credits?:{usd:string;observedAt:number}|null;plan?:SubscriptionView|null;endsAt?:number|null;codeEntry?:boolean;onRedeem:(code:string)=>Promise<boolean>;onAddFunds:()=>void;onRefresh:()=>void}){
 const code=useRef<HTMLInputElement>(null),pending=useRef(false),codeEntryId=useId(),errorId=useId();
 // A retained redemption error must keep its associated input exposed.
 const [codeVisible,setCodeVisible]=useState(Boolean(error)),[submitting,setSubmitting]=useState(false),[submissionError,setSubmissionError]=useState(''),[codeValue,setCodeValue]=useState('');
 const active=plan?.kind==='active',disabled=busy||submitting,showCode=codeVisible||codeEntry,explicitEntry=useRef(codeEntry);
 useEffect(()=>{if(explicitEntry.current&&!codeEntry){setCodeValue('');setSubmissionError('');setCodeVisible(Boolean(error));}explicitEntry.current=codeEntry;},[codeEntry,error]);
 useEffect(()=>{if(showCode)code.current?.focus();},[showCode]);
 async function redeem(event:React.FormEvent){
  event.preventDefault();const input=code.current;
  if(!input||!input.value.trim()||disabled||pending.current)return;
  pending.current=true;setSubmitting(true);setSubmissionError('');
  try{const ok=await onRedeem(input.value);if(ok&&code.current===input)setCodeValue('');}
  catch{setSubmissionError('Code redemption could not be confirmed. Check your account before trying again.');}
  finally{pending.current=false;setSubmitting(false);}
 }
 return <section className="alpha-membership" aria-label="Membership and credits">
   <p className="alpha-membership-account">{email||'Signed in to Eliza Cloud'}</p>
   <dl className="alpha-membership-facts">
    <div className="alpha-membership-credit-fact"><dt>Available credits</dt><dd>
     <div className="alpha-membership-balance"><span className={credits?'alpha-membership-amount':'alpha-membership-amount-unavailable'}>{credits?<>{creditLabel(credits.usd)}<span className="alpha-membership-currency">USD</span></>:balance==='checking'?'Checking…':'Not available'}</span><button type="button" className="alpha-membership-refresh" disabled={disabled||balance==='checking'} onClick={onRefresh}>{balance==='checking'?'Checking…':'Refresh'}</button></div>
     {credits&&<small className="alpha-membership-fresh">Checked {new Date(credits.observedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</small>}
    </dd></div>
    <div className="alpha-membership-plan-fact"><dt>Membership</dt><dd>{active?plan.planName:plan?.kind==='inactive'||plan?.kind==='credits'?'No active membership':balance==='checking'?'Checking…':'Not confirmed'}{active&&<small>{typeof endsAt==='number'&&Number.isFinite(endsAt)?endLabel(endsAt):'End date not provided'}</small>}</dd></div>
   </dl>
   <p className="alpha-membership-support" role="status">{balance==='checking'?'Checking your account…':balance==='unavailable'?'Account details could not be refreshed. You can still redeem a code or check again.':balance==='zero'?'Add funds or use a membership code to ask Alpha.':''}</p>
   <div className="alpha-membership-main-actions"><button type="button" className="alpha-membership-primary" disabled={disabled} onClick={onAddFunds}>Add funds</button>{!showCode&&<button type="button" className="alpha-membership-secondary" aria-expanded={false} aria-controls={codeEntryId} disabled={disabled} onClick={()=>setCodeVisible(true)}>Use membership code</button>}</div>
   {showCode&&<div id={codeEntryId} className="alpha-membership-code-entry"><form aria-label="Redeem a membership code" onSubmit={event=>void redeem(event)}>
     <label>Membership code<input ref={code} name="membership-code" value={codeValue} onChange={event=>setCodeValue(event.target.value)} placeholder="Enter code" autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-autofill-ignore="true" maxLength={64} disabled={disabled} required aria-invalid={!!error||!!submissionError||undefined} aria-describedby={error||submissionError?errorId:undefined}/></label>
     <button type="submit" disabled={disabled||!codeValue.trim()}>{submitting?'Redeeming…':'Redeem'}</button>
   </form></div>}
   {[...new Set([error||submissionError,connectionError].filter((value):value is string=>!!value))].map((value,index)=><p key={value} id={index===0?errorId:undefined} role="alert">{value}</p>)}{notice&&<p role="status">{notice}</p>}
 </section>;
}

/** Acknowledgment is not proof of the external browser session; the owner must check it there. */
export function BillingAccountReview({email,busy,error,onOpen,onCancel}:{email:string;busy:boolean;error?:string;onOpen:()=>void;onCancel:()=>void}){
 const [acknowledged,setAcknowledged]=useState(false);
 return <section className="alpha-billing-review"><header><h1 className="serif">Check the billing account</h1></header><p>Alpha is signed in as <strong>{email}</strong>.</p><p>Your browser may be signed into a different account. Before paying, use the billing page’s account menu to check it shows <strong>{email}</strong>. Funds go to the account shown there.</p><form onSubmit={event=>{event.preventDefault();if(acknowledged&&!busy)onOpen();}}><label><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)} disabled={busy} required/>I’ll check the account before paying.</label><div className="alpha-membership-actions"><button type="submit" disabled={!acknowledged||busy}>Open billing</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></form>{error&&<p role="alert">{error}</p>}</section>;
}
