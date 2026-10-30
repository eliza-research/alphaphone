import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPlane as SharedMapPlane, type MapBasemap } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';
import {visibleMapPadding} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-layout.ts';
import fontUrl from '@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { nativeRegion, nativeRegionRequest } from './regional-provider';
import {alphaPaletteColor} from '../product/alpha-product';
/** Product palette, typography and host overlay geometry for the shared map plane. */
export class MapPlane extends SharedMapPlane {
 constructor(container:HTMLElement,region:MapBasemap,onError:()=>void,colors:Record<string,string>,onPin?:(id:string)=>void) {
  const padding=()=>visibleMapPadding(container);
  // MapLibre reads these numeric members when it fits a route, after rotation/reflow too.
  const routePadding={get top(){return padding().top;},get bottom(){return padding().bottom;},get left(){return padding().left;},get right(){return padding().right;}};
  super(container,region,onError,colors,{fontUrl,workerUrl,accent:alphaPaletteColor('--alpha-blue')!,protocol:'alpha-region',routePadding,nativeRegion,nativeRequest:nativeRegionRequest,selectionPadding:padding,onPin});
 }
}
