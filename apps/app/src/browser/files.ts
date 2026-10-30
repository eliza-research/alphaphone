import { createBrowserFiles } from '../product/files-upstream';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { openSelectedDocumentViewer } from './selected-document-viewer';
import { runFilePicker, inputFiles } from './file-picker';
/** Keep installed data and Alpha presentation; storage behavior belongs to plugin-files. */
const SharedFiles = createBrowserFiles({
 databaseName: 'alpha.browser.files.v1',
 archiveName: 'Alpha files.zip',
 pdfWorkerUrl,
 pdfAssetsBase: '/pdfjs-assets/',
 openSelectedDocumentViewer,
 runFilePicker,
 inputFiles,
});
export class BrowserFiles extends SharedFiles {
 private readonly sourceSelections=new Map<string,string>();
 async select(input:{id:string}){const selected=await super.select(input);this.sourceSelections.set(selected.selectionId,input.id);return selected;}
 async forgetSelected(input:{selectionId:string}){this.sourceSelections.delete(input.selectionId);return super.forgetSelected(input);}
 async sourceReference(input:{selectionId:string}){await this.attachment(input);const id=this.sourceSelections.get(input.selectionId);if(!id||!/^[a-f0-9-]{36}$/.test(id))throw Error('Select the library file again.');return 'b1:'+id;}
 async selectSourceReference(reference:string){if(!/^b1:[a-f0-9-]{36}$/.test(reference))throw Error('Source belongs to another device or is unavailable.');return this.select({id:reference.slice(3)});}
}
