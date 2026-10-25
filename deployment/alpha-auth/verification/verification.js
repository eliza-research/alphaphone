(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  // Public configuration/state is removed before loading any provider scripts.
  history.replaceState(null, '', location.pathname);
  const state=params.get('state'),provider=params.get('provider'),sitekey=params.get('siteKey'),action=params.get('action');
  const status=document.getElementById('status');
  if(!/^[a-f0-9-]{36}$/.test(state||'')||!['turnstile','hcaptcha'].includes(provider)||!sitekey||!['email_otp','sms_otp'].includes(action)) {status.textContent='Verification could not start. Return to the app and try again.';return;}
  let finished=false;
  const finish=(token)=>{
    if(finished)return;finished=true;
    // The isolated native host intercepts this navigation; the fragment is never sent to a server.
    const result=new URL('result',location.href);result.hash=new URLSearchParams({state,...(typeof token==='string'&&token?{token}:{error:'cancelled'})}).toString();
    location.replace(result.href);
  };
  document.getElementById('cancel').onclick=()=>finish();
  window.onVerificationReady=()=>{
    const widget=provider==='turnstile'?window.turnstile:window.hcaptcha;
    widget.render('#challenge',{sitekey,action,callback:token=>finish(token),'error-callback':()=>{status.textContent='Verification failed. Cancel and try again.';},'expired-callback':()=>{status.textContent='Verification expired. Cancel and try again.';}});
    status.textContent='Complete the verification above.';
  };
  const script=document.createElement('script');
  script.src=provider==='turnstile'?'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onVerificationReady&render=explicit':'https://js.hcaptcha.com/1/api.js?onload=onVerificationReady&render=explicit';
  script.async=true;script.onerror=()=>{status.textContent='Verification could not load. Cancel and try again.';};document.head.append(script);
})();
