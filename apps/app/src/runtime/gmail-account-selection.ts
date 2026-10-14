/** An account-selection hint only: no tokens, mail or grant authority. The server
 * still authorizes every read; use it to overlap a first-page read with account discovery. */
type Owner={environment:string;userId:string;organizationId?:string};
type Storage={getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
const storage=():Storage|undefined=>{try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return undefined;}};
const key=(owner:Owner)=>'alpha.gmail.account-choice.v1:'+JSON.stringify([owner.environment,owner.userId,owner.organizationId||'']);
export function readGmailAccountChoice(owner:Owner|null,port=storage()):string|null{
 if(!owner||!port)return null;
 try{const id=JSON.parse(port.getItem(key(owner))||'null');return typeof id==='string'&&id.length>0&&id.length<=256&&!/\s/.test(id)?id:null;}catch{return null;}
}
export function saveGmailAccountChoice(owner:Owner|null,id:string|null,port=storage()):void{
 if(!owner||!port)return;
 try{if(id===null)port.removeItem(key(owner));else if(id.length>0&&id.length<=256&&!/\s/.test(id))port.setItem(key(owner),JSON.stringify(id));}catch{/* Discovery remains available if this optional hint cannot be saved. */}
}
