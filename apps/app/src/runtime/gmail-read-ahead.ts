/** Bounded, memory-only read-ahead. One speculative request at a time; retain at
 * most eight completed folder pages for 30s. No polling or automatic retry. */
export class GmailReadAhead<T> {
  private pending: {key:string;cursor:string;at:number;controller:AbortController;result:Promise<{ok:true;value:T}|{ok:false;error:unknown}>}|null=null;
  private ready=new Map<string,{cursor:string;at:number;value:T}>();
  constructor(private readonly ttlMs=30000,private readonly now=()=>Date.now()){}
  invalidate(key?:string){
    if(key===undefined||this.pending?.key===key){this.pending?.controller.abort();this.pending=null;}
    if(key===undefined)this.ready.clear();else this.ready.delete(key);
  }
  pause(){this.pending?.controller.abort();this.pending=null;}
  prepare(key:string,cursor:string,read:(signal:AbortSignal)=>Promise<T>){
    const ready=this.ready.get(key);
    if(ready?.cursor===cursor&&this.now()-ready.at<this.ttlMs)return;
    if(this.pending?.key===key&&this.pending.cursor===cursor&&this.now()-this.pending.at<this.ttlMs)return;
    this.pause();this.ready.delete(key);const controller=new AbortController(),at=this.now();
    const result=read(controller.signal).then(value=>{
      if(this.pending?.controller===controller&&!controller.signal.aborted){
        this.pending=null;this.ready.set(key,{cursor,at,value});while(this.ready.size>8)this.ready.delete(this.ready.keys().next().value!);
      }
      return {ok:true as const,value};
    },error=>({ok:false as const,error}));
    this.pending={key,cursor,at,controller,result};
  }
  async take(key:string,cursor:string,signal:AbortSignal):Promise<T|undefined>{
    signal.throwIfAborted();const ready=this.ready.get(key);
    if(ready?.cursor===cursor){this.ready.delete(key);if(this.now()-ready.at<this.ttlMs)return ready.value;}
    const row=this.pending;if(!row||row.key!==key||row.cursor!==cursor)return undefined;
    if(this.now()-row.at>=this.ttlMs){this.invalidate(key);return undefined;}
    this.pending=null;const abort=()=>row.controller.abort();signal.addEventListener('abort',abort,{once:true});
    try{const result=await row.result;signal.throwIfAborted();row.controller.signal.throwIfAborted();if(!result.ok)throw result.error;return result.value;}
    finally{signal.removeEventListener('abort',abort);}
  }
}
