import type {NoteRecord} from '../runtime/notes-store';
/** Reconcile UI with a settled canonical collection, never a write payload.
 * The previous acknowledged raw document is the editor's clean baseline. */
export function notesEditorRefresh(baselineRaw:string|undefined,visible:NoteRecord[],committedRaw:string,committed:NoteRecord[]):{kind:'unchanged'}|{kind:'conflict'}|{kind:'refresh';list?:NoteRecord[]}{
 if(baselineRaw===committedRaw)return{kind:'unchanged'};
 if(JSON.stringify(visible)===JSON.stringify(committed))return{kind:'refresh'};
 let baseline:unknown;
 try{baseline=JSON.parse(baselineRaw??'');}catch{return{kind:'conflict'};}
 if(!baseline||typeof baseline!=='object'||!('version'in baseline)||baseline.version!==2||!('records'in baseline)||!Array.isArray(baseline.records)||JSON.stringify(visible)!==JSON.stringify(baseline.records))return{kind:'conflict'};
 return{kind:'refresh',list:structuredClone(committed)};
}
