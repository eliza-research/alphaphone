/** Browser models only. Native delayed writes authenticate owner context independently. */
let current:()=>string|null=()=>null;
export function bindBrowserDeletionOwner(read:()=>string|null){current=read;}
export function browserDeletionOwner():string{const owner=current();if(!owner)throw Error('Connected owner is unavailable.');return owner;}
export function browserDeletionOwnerCurrent(owner:string):boolean{return owner.startsWith('manual:')||owner===current();}
/** Returning to the same enrolled owner can cancel an old intent, never execute it. */
export function browserDeletionOwnerVisible(owner:string):boolean{
 if(owner.startsWith('manual:'))return true;const active=current();if(!active||!owner.startsWith('agent:')||!active.startsWith('agent:'))return false;
 try{const before=JSON.parse(owner.slice(6)),after=JSON.parse(active.slice(6));return Array.isArray(before)&&Array.isArray(after)&&before.length===6&&after.length===6&&[0,1,2,4,5].every(index=>typeof before[index]==='string'&&before[index]===after[index]);}catch{return false;}
}
