import {connectionController} from './connection-ui';
/**
 * The only Alpha glue the projected stock plugin-notes client (notesData.ts) needs: its `@elizaos/ui`
 * transport imports, served by the active agent's owner-route client. No CSRF header is needed: the
 * bridge supplies the owner credential and the server admits the route by its exact policy.
 */
export class ApiError extends Error {
  readonly kind: string; readonly path: string; readonly status?: number; readonly code?: string; readonly data?: unknown;
  constructor(options:{kind:string;path:string;message:string;status?:number;code?:string;data?:unknown}) {
    super(options.message);this.name='ApiError';this.kind=options.kind;this.path=options.path;this.status=options.status;this.code=options.code;this.data=options.data;
  }
}
const notesClient=(path:string)=>{const nc=connectionController.getNotesClient();if(!nc)throw new ApiError({kind:'unavailable',path,message:'Your agent is not connected.'});return nc;};
const failure=(error:unknown)=>error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'?error as {status:number;data?:unknown;message?:string}:null;
export const client={
  async fetch<T>(path:string,init:RequestInit):Promise<T>{
    try{return await notesClient(path).request(path,'GET',undefined,init.signal??new AbortController().signal) as T;}
    catch(error){const http=failure(error);if(http)throw new ApiError({kind:'http',path,status:http.status,message:http.message||`Notes request failed with HTTP ${http.status}.`,data:http.data});throw error;}
  },
};
export async function fetchWithCsrf(path:string,init:RequestInit):Promise<Response>{
  const nc=notesClient(path);
  try{return new Response(JSON.stringify(await nc.request(path,'POST',JSON.parse(String(init.body)),init.signal??new AbortController().signal)),{status:200});}
  catch(error){const http=failure(error);if(http)return new Response(JSON.stringify(http.data??{}),{status:http.status});throw error;}
}
