import {createContext} from 'react';
import type {MapsScreenHandle} from '../maps/screen';
import type {MapBasemap} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/map-plane.ts';

export interface MapsHostView {
  screen: MapsScreenHandle;
  mapRevision: number;
  basemap: MapBasemap;
  colors: Record<string,string>;
  covered: boolean;
  agentName: string;
  onAskAgent(text:string):void;
  onBack():void;
  onOpenLocationSettings():void;
  eventReturn:{title:string;onReturn():void}|null;
  disclosure:string;
  agentNavigation:{offered:boolean;relay:boolean};
}
/** Platform inputs only. The lazy Maps view imports no prototype renderer. */
export const MapsHostContext=createContext<MapsHostView|null>(null);
