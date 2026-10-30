import {useCallback,useContext,type CSSProperties} from 'react';
import type {MobileViewProps} from '@elizaos/ui/mobile-shell/core';
import {MapsScreen} from '../../../../.eliza/client-features/plugins/plugin-maps/src/screen.ts';
import {MapPlane} from '../maps/map-plane';
import {MapsHostContext} from './maps-host-context';
const linkStyle={color:'var(--maps-link, currentColor)'};

/** The same plugin-maps React view used by the upstream phone, with Alpha's host ports. */
export default function CanonicalMapsView({active}:MobileViewProps){
  const host=useContext(MapsHostContext);
  const createPlane=useCallback((element:HTMLElement,onError:()=>void,onPin:(id:string)=>void)=>{
    if(!host)throw Error('Maps host is unavailable.');
    return new MapPlane(element,host.basemap,onError,host.colors,onPin);
  },[host?.basemap,host?.colors,host?.mapRevision]);
  if(!host||active===false)return null;
  const global=host.basemap.kind==='global';
  return <section data-alpha-layer="app" data-alpha-shared-maps data-alpha-maps-root data-map-diagnostics={JSON.stringify({...host.screen.controller.view().diagnostics,agentNavigation:host.agentNavigation})} inert={host.covered||undefined} aria-hidden={host.covered} style={{position:'absolute',inset:0,zIndex:21}}>
    <MapsScreen screen={host.screen} createPlane={createPlane} releaseOnUnmount={false}
      mapLabel={global?'World map':'Regional map'}
      attribution={global?<><a style={linkStyle} href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · <a style={linkStyle} href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> · <a style={linkStyle} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Data from OpenStreetMap</a></>:<a style={linkStyle} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{host.basemap.attribution}</a>}
      mapPrivacy={global?'OpenFreeMap receives your IP address and viewed map area. Location is used only when you request it.':undefined}
      disclosure={host.disclosure} agentName={host.agentName} onAskAgent={host.onAskAgent} onBack={host.onBack}
      onOpenLocationSettings={host.onOpenLocationSettings} eventReturn={host.eventReturn}
      style={{'--maps-guidance':'var(--acc)','--maps-guidance-then':'var(--alpha-blue-deep)','--maps-nav-bar':'var(--alpha-gray-15)','--maps-nav-button':'var(--alpha-gray-26)','--maps-inset-top':'44px','--maps-text-scale':'var(--alpha-text-scale, 1)','--maps-bottom-clearance':'max(88px, var(--alpha-chat-clearance, 0px))'} as CSSProperties}/>
  </section>;
}
