import {fetchNotesState,interact,type NotesInteractResult} from '../../../../.eliza/client-features/plugins/plugin-notes/src/components/notesData.ts';
import {reconstructNoteContent,type NotesSnapshot,type StickyNote} from '../../../../.eliza/client-features/plugins/plugin-notes/src/types.ts';
import {connectionController} from '../runtime/connection-ui';

const BACKOFF=[1,2,4,8,16,30];
/** Plugin routes register after the agent session is ready; past this a missing route means the plugin is not loaded. */
const MISSING_ROUTE_MS=60000;
const startingError=(error:unknown)=>error instanceof Error&&((error as {status?:unknown}).status===404||error.message.includes('Missing client id for frontend view interaction'));

/**
 * The agent's own stock plugin-notes store (owner decisions D1, D2: stock parity). Reads and edits go
 * through the stock notes client only; nothing here touches the phone Notes collection, its Trash or drafts.
 */
export class AgentNotes {
  status:'idle'|'starting'|'ready'|'unavailable'='idle';
  snapshot:NotesSnapshot|null=null;
  error='';busy=false;
  private session:string|undefined;private loading:Promise<void>|null=null;private queue:Promise<unknown>=Promise.resolve();
  /** Blur and Done save the same text once; a failed save is never retried by the second request. */
  private saving:{key:string;run:Promise<boolean>}|null=null;
  private missingSince=0;private attempt=0;private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(private publish:()=>void,private visible:()=>boolean){}
  /** Whole-snapshot read; a route that is not registered yet is "starting", never an empty list. */
  refresh():Promise<void>{
    if(!this.visible())return Promise.resolve();
    return this.loading??=(async()=>{
      const session=connectionController.getNotesClient()?.sessionId;
      if(session!==this.session){this.session=session;this.snapshot=null;this.missingSince=0;this.attempt=0;}
      try{
        if(!session){this.status=connectionController.getSnapshot().kind==='starting'?'starting':'idle';}
        else{this.snapshot=await fetchNotesState();this.status='ready';this.missingSince=0;this.attempt=0;}
      }catch(error){
        const starting=startingError(error);
        if(starting&&!this.missingSince)this.missingSince=Date.now();
        this.status=starting&&Date.now()-this.missingSince<=MISSING_ROUTE_MS?'starting':'unavailable';
      }
      clearTimeout(this.timer);
      if(this.status==='starting')this.timer=setTimeout(()=>void this.refresh(),BACKOFF[Math.min(this.attempt++,BACKOFF.length-1)]*1000);
      this.publish();
    })().finally(()=>{this.loading=null;});
  }
  /** One mutation at a time; each reads the snapshot when it starts (null params: nothing to send) and adopts the returned state wholesale. */
  private mutate(capability:string,params:(snapshot:NotesSnapshot|null)=>Record<string,unknown>|null):Promise<boolean>{
    const run=this.queue.then(async()=>{
      const body=params(this.snapshot),revision=this.snapshot?.revision;if(!body)return true;
      this.busy=true;this.error='';this.publish();
      try{const result:NotesInteractResult=await interact(capability,body);this.snapshot=result.state;this.status='ready';return true;}
      catch(error){
        // Conflict, validation or an unknown transport outcome: re-read, keep the editor text and never resend.
        await this.refresh();
        this.error=startingError(error)?'Your agent is still starting. Nothing was saved; try again shortly.':this.snapshot&&revision!==undefined&&this.snapshot.revision!==revision?'Changed by your agent. Review and save again.':error instanceof Error?error.message:'Alpha notes could not be saved.';
        return false;
      }finally{this.busy=false;this.publish();}
    });
    this.queue=run.catch(()=>{});return run;
  }
  create(content:string){return content.trim()?this.mutate('create-note',()=>({content})):Promise.resolve(false);}
  update(id:string,content:string){
    if(!content.trim()){this.error='An Alpha note cannot be empty. Delete it instead.';this.publish();return Promise.resolve(false);}
    const key=id+'\0'+content;if(this.saving?.key===key)return this.saving.run;
    const run=this.mutate('update-note',snapshot=>{const note=snapshot?.notes.find(item=>item.id===id);return note&&reconstructNoteContent(note)===content?null:{id,content,expectedRevision:snapshot?.revision};});
    this.saving={key,run};void run.finally(()=>{if(this.saving?.run===run)this.saving=null;});return run;
  }
  /** Stock delete has no Trash (D2); the caller keeps the returned content for Undo. */
  async remove(note:StickyNote){return await this.mutate('delete-note',()=>({id:note.id}))?reconstructNoteContent(note):null;}
  view(){
    const connection=connectionController.getSnapshot();
    return {status:this.status,busy:this.busy,error:this.error,source:connection.session&&connection.kind!=='resident'?connection.name:'',notes:(this.snapshot?.notes||[]).map(note=>({id:note.id,text:reconstructNoteContent(note),note}))};
  }
  dispose(){clearTimeout(this.timer);}
}
