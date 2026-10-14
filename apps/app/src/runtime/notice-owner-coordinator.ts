export interface NoticeOwnerSnapshot {identity:string;owner:{origin:string;ownerId:string;agentId:string}|null;hasSession:boolean;startupResolved?:boolean;busy?:boolean}
/** The native privacy fence starts immediately; remote revalidation stays in the notice work queue.
 * Initial session restoration and retry-needed are separate states, so a failed call never hides sign-out. */
export class NoticeOwnerCoordinator<T> {
 private initialized=false;private identity='';private retryNeeded=false;private generation=0;
 constructor(private readonly operations:{transition:(snapshot:NoticeOwnerSnapshot)=>Promise<T>;enqueue:(work:()=>Promise<void>)=>void;available:(snapshot:NoticeOwnerSnapshot)=>boolean;restore:(result:T,snapshot:NoticeOwnerSnapshot,valid:()=>boolean)=>Promise<void>}){}
 update(snapshot:NoticeOwnerSnapshot){
  if(!this.initialized){if(!snapshot.hasSession&&!snapshot.startupResolved)return;this.initialized=true;this.retryNeeded=true;}
  // A reconnect (Continue, Check plan again, pairing) retires the session while the connection is
  // busy. Withdrawal without an owner is terminal for result and digest notices, so a null owner is
  // published only once the connection settles; a reconnect to the same owner never withdraws them.
  if(!snapshot.hasSession&&snapshot.busy)return;
  if(snapshot.identity===this.identity&&!this.retryNeeded)return;
  this.identity=snapshot.identity;this.retryNeeded=false;const generation=++this.generation;
  const transition=this.operations.transition(snapshot).then(result=>({result,error:null}),error=>({result:null,error}));
  const valid=()=>generation===this.generation&&this.operations.available(snapshot);
  const retry=()=>{if(generation===this.generation)this.retryNeeded=true;};
  this.operations.enqueue(async()=>{try{
   const completed=await transition;if(completed.error||completed.result===null)throw completed.error;
   if(generation!==this.generation||!snapshot.hasSession)return;
   if(!valid()){retry();return;}
   await this.operations.restore(completed.result,snapshot,valid);
   if(!valid())retry();
  }catch{retry();}});
 }
}
