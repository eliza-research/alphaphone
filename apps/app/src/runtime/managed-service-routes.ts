/** Product transport admits managed services, never agent hosts or provisioning. */
export function managedServiceRequest(url:string,method:string,hasBody=false):boolean {
 let parsed:URL;try{parsed=new URL(url);}catch{return false;}
 if(parsed.origin!=='https://api.eliza.app'||parsed.username||parsed.password||parsed.hash)return false;
 const path=parsed.pathname;
 if(/[\\%]/.test(path)||path.includes('//'))return false;
 if(method==='DELETE')return path==='/api/v1/api-keys/current'&&!parsed.search&&!hasBody;
 if(method==='POST')return !parsed.search&&(path==='/api/auth/cli-session'||path==='/api/v1/eliza/google/connect/initiate'||path==='/api/v1/eliza/google/disconnect'||path==='/api/v1/eliza/google/gmail/inbox-v1/operations'||/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/[A-Za-z0-9_-]{1,160}\/dispatch$/.test(path));
 if(method!=='GET'||hasBody)return false;
 return /^\/api\/auth\/cli-session\/[0-9a-fA-F-]{36}$/.test(path)||['/api/v1/user','/api/v1/credits/balance','/api/v1/subscription/entitlement','/api/v1/subscription/entitlement-keys','/api/v1/eliza/google/accounts','/api/v1/eliza/google/status','/api/v1/eliza/google/gmail/search','/api/v1/eliza/google/gmail/read'].includes(path)||/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/(capabilities|thread|attachment|drafts|draft)$/.test(path)||/^\/api\/v1\/eliza\/google\/gmail\/inbox-v1\/operations\/[A-Za-z0-9_-]{1,160}$/.test(path);
}
