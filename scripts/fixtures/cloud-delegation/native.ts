export const secureConnectionStore={async read(slot:string){return JSON.parse(localStorage.getItem(slot)||'null');},async compareExchange(slot:string,expected:unknown,value:unknown){if(JSON.stringify(await this.read(slot))!==JSON.stringify(expected))return{status:'conflict'};if(value===null){if((window as any).holdClear)await new Promise<void>(resolve=>{(window as any).releaseClear=resolve;});localStorage.removeItem(slot);}else {localStorage.setItem(slot,JSON.stringify(value));if((value as any).authUrl)(window as any).authorizationUrl=(value as any).authUrl;}return{status:'saved'};}};
export async function nativeAlphaAuthenticate(environment: string, signal: AbortSignal, purpose: string) {
 signal.throwIfAborted(); (window as any).authPurpose=purpose;
 (window as any).interactiveAuthentications=((window as any).interactiveAuthentications||0)+1;
 if ((window as any).holdAuthentication) await new Promise<void>(resolve => { (window as any).releaseAuthentication=resolve; });
 return 'interactive-fixture';
}
export async function clearAlphaAuthenticationPurpose(purpose: string) { (window as any).clearedPurpose = purpose; }
export const alphaAuthHost = {
 async read() { return JSON.parse(localStorage.getItem('fixture-auth-pending') || 'null'); },
 async callback() { return localStorage.getItem('fixture-auth-callback'); },
 async write(value: unknown) { localStorage.setItem('fixture-auth-pending',JSON.stringify(value)); },
 async clear() { localStorage.removeItem('fixture-auth-pending'); },
 async open() {},
 async clearCallback() { localStorage.removeItem('fixture-auth-callback'); },
};
export async function nativeCloudRequest(input: any) {
 const url=new URL(input.url); input.signal.throwIfAborted();
 if(url.pathname==='/api/v1/app-auth/delegations/registration')return {status:200,data:{success:true,app:{id:url.searchParams.get('appId'),name:'Alpha Phone fixture'},scopes:url.searchParams.get('scopes')!.split(' ')}};
 if(url.pathname==='/api/v1/app-auth/connect') {
  if(input.headers.Authorization!=='Bearer interactive-fixture')throw Error('Expected interactive session');
  (window as any).consentBody=input.body;
  (window as any).consentPosts=((window as any).consentPosts||0)+1;
  return {status:200,data:{success:true,codeType:'app_delegation_code',code:'c'.repeat(43)}};
 }
 throw Error('Unexpected backend request');
}
