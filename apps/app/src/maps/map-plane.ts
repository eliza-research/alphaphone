import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPlane as SharedMapPlane, type MapBasemap } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
export type { MapOverlay, MapPin, MapPosition } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import fontUrl from '@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { nativeRegion, nativeRegionRequest } from './regional-provider';
/** Product palette, typography and space reserved for the Alpha route sheets. */
export class MapPlane extends SharedMapPlane {
 private readonly selectionSpace?:()=>{top:number;bottom:number;left:number;right:number};
 private readonly layoutObserver?:MutationObserver;
 private layoutFrame=0;
 private requestedUpdate?:Parameters<SharedMapPlane['update']>;
 // Distinct from the shared plane's private `selectionLayout` (plugin-maps 5176c4523c), which
 // reflows the selection itself; this override can go once the pin includes that commit.
 private productSelectionLayout='';
 constructor(container:HTMLElement,region:MapBasemap,onError:()=>void,colors:Record<string,string>,onPin?:(id:string)=>void) {
  const selectionSpace=region.kind==='global'?()=>{
   const bounds=container.getBoundingClientRect();
   const credits=container.parentElement?.querySelector('.alpha-map-credits')?.getBoundingClientRect();
   const header=container.parentElement?.querySelector('[data-alpha-app-header="main"]')?.getBoundingClientRect();
   const sheet=container.parentElement?.querySelector('[data-alpha-maps-sheet]')?.getBoundingClientRect();
   const right=sheet&&sheet.left>bounds.left+30?Math.max(30,bounds.right-sheet.left+30):30;
   return {top:header?header.bottom-bounds.top+60:100,bottom:credits?bounds.bottom-credits.top+16:Math.min(430,container.clientHeight*.52+30),left:30,right};
  }:undefined;
  super(container,region,onError,colors,{fontUrl,workerUrl,accent:'#1616d8',protocol:'alpha-region',routePadding:{top:220,bottom:280,left:30,right:30},nativeRegion,nativeRequest:nativeRegionRequest,selectionPadding:selectionSpace,onPin});
  this.selectionSpace=selectionSpace;
  if(selectionSpace){
   // The shared renderer publishes zoom when idle, after resized tiles are ready.
   this.layoutObserver=new MutationObserver(()=>{
    cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame=requestAnimationFrame(()=>{this.layoutFrame=0;this.refreshSelectionLayout();});
   });
   this.layoutObserver.observe(container,{attributes:true,attributeFilter:['data-map-zoom']});
  }
 }
 override update(...args:Parameters<SharedMapPlane['update']>) {
  this.requestedUpdate=args;
  super.update(...args);
 }
 private refreshSelectionLayout() {
  if(!this.requestedUpdate)return;
  const [selected,route,overlay]=this.requestedUpdate;
  const layout=this.selectionSpace?Object.values(this.selectionSpace()).map(Math.round).join(','):'';
  // Alpha moves the sheet on rotation while the selected coordinates stay the same.
  // Reapply selection space without disturbing route or navigation camera ownership.
  const changed=this.productSelectionLayout&&layout!==this.productSelectionLayout;
  this.productSelectionLayout=layout;
  if(!changed||!selected||route||overlay?.follow)return;
  super.update(undefined,route,overlay);
  super.update(...this.requestedUpdate);
 }
 override destroy() {
  this.layoutObserver?.disconnect();
  cancelAnimationFrame(this.layoutFrame);
  this.requestedUpdate=undefined;
  super.destroy();
 }
}
