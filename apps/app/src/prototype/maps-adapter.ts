import React from 'react';
import {MobileViewHost,type MobileViewFailure} from '@elizaos/ui/mobile-shell';
import {alphaViews,alphaPaletteColor} from '../product/alpha-product';
import {MapsHostContext} from '../product/maps-host-context';
import {recordRendererFailure} from '../runtime/crash-log';
import {BackgroundNavigation,type NavigationBridge} from '../maps/background-navigation';
import {registerPlugin} from '../platform-plugins';
import {DailyApps} from '../daily';
import {mapsEventReturnOffered,mapsEventStillThere,type MapsEventOrigin} from '../runtime/maps-event-return';
import {Capacitor} from '@capacitor/core';
import {isAndroid} from '../native';
import {NavigationVoice} from '../maps/navigation-voice';
import {shareMap} from '../maps/share';
import { globalBasemap } from '../maps/basemap';
import { initializeRegionalMaps, regionalMap, regionalDiagnostics, regionalMapsConfigured } from '../maps/regional-provider';
import { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics } from '../maps/cloud-maps';
import { describeMapsDisclosure, insideCloudCoverage } from '../maps/cloud-provider';
import { NativeMapsLocation, locationPermissionGranted } from '../maps/native-location';
import { bindAgentNavigation, residentMapsNavigationPort } from '../maps/agent-navigation';
import { publishMapsSelection, clearMapsSelection } from '../maps/agent-context';
import { MapsController } from '../maps/state';
import { mapsConnection, onMapsConnectionChange } from '../maps/runtime';
import { createMapsScreen } from '../maps/screen';
import { connectionController } from '../runtime/connection-ui';
import {testMocksEnabled} from '../build-flags';
import {MapsFailure} from '../maps/contracts';
import {SavedPlaces} from '../maps/saved-places';
import type {MapsLocation} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/location.ts';

type Bag = Record<string, any>;
const mapsConnected = () => mapsConnection().config.status === 'configured';

/**
 * Alpha's ports for the shared Maps controller and React view. The view loads through
 * MobileViewHost; this module owns only platform, Calendar and agent integration.
 * Product builds use Eliza Cloud Maps; the regional gateway is a test-mocks prototype.
 */
export function installCanonicalMapsView(Component: { prototype: Bag }, views: Record<string, Bag>, options:{simulated?:boolean}={}): () => void {
  const simulated=testMocksEnabled&&options.simulated===true;
  const device=registerPlugin<{openSettings(input:{page:string}):Promise<unknown>}>('AlphaDevice');
  const module = views.maps; if (!module) return () => {};
  const original = { render: module.render, back: module.back, onLeave: module.onLeave, reply: module.reply, suggestions: module.suggestions, ongoing: module.ongoing };
  let api: Bag | undefined, disposed=false, renders=0, mapRevision=0;
  let pendingHandoff: {query:string}|undefined;
  const active=()=>!disposed&&!document.hidden&&!!api?.isActive();
  const paint=()=>{if(active())api?.set({nativeMapsRevision:++renders});};
  const navigationVoice=new NavigationVoice(error=>screen.notify((error instanceof Error?error.message+' ':'')+'Voice guidance paused. Tap Enable voice guidance to retry.'));
  const background=new BackgroundNavigation(registerPlugin<NavigationBridge>('AlphaMapsTransport'),()=>!simulated&&Capacitor.isNativePlatform());
  const unavailableLocation:MapsLocation={awaitingPermission:()=>false,start:async(_oneShot,_onFix,onError)=>{onError(new MapsFailure('permission-denied','Location is unavailable in this preview. Enter coordinates instead.'));},stop:async()=>{}};
  let previewSaved:string|null=null;
  const previewPlaces=simulated?new SavedPlaces({getItem:()=>previewSaved,setItem:(_key,value)=>{previewSaved=value;}}):undefined;
  const handle = createMapsScreen({
    connection: simulated?()=>({config:{status:'unconfigured'}}):mapsConnection,
    onConnectionChange: simulated?()=>()=>{}:changed=>onMapsConnectionChange(()=>{changed();paint();}),
    initialize: () => simulated?Promise.resolve():regionalMapsConfigured ? initializeRegionalMaps() : initializeCloudMaps(),
    diagnostics: () => simulated?{configured:false,error:''}:regionalMapsConfigured ? regionalDiagnostics() : cloudMapsDiagnostics(),
    coverage: () => {
      if(simulated)return undefined;
      const region=regionalMap();
      if(region)return {name:region.region,mapRestricted:true,contains:point=>point.longitude>=region.bounds[0]&&point.latitude>=region.bounds[1]&&point.longitude<=region.bounds[2]&&point.latitude<=region.bounds[3]};
      const cloud=cloudMapsCoverage();
      return cloud&&{name:cloud.regions.map(item=>item.name).join(', '),mapRestricted:false,contains:point=>insideCloudCoverage(cloud,point)};
    },
    attribution: () => simulated?'':regionalMap()?.attribution || cloudMapsCoverage()?.attribution || '',
    createController: (config, provider) => new MapsController(config, provider, previewPlaces, simulated?unavailableLocation:undefined),
    navigationLocation: simulated?unavailableLocation:new NativeMapsLocation(),
    agentLocation: simulated?unavailableLocation:new NativeMapsLocation(),
    locationGranted: simulated?async()=>false:locationPermissionGranted,
    voice: simulated?{enabled:false,update:()=>{},pause:()=>{},toggle:()=>screen.notify('Voice guidance is unavailable in this preview.')}:navigationVoice,
    background,
    share: simulated?async()=>{screen.notify('Sharing is unavailable in this preview.');return 'closed';}:shareMap,
    openWebsite: url => {
      if(simulated){api?.toast('Opening websites is unavailable in this preview.');return;}
      if (Capacitor.isNativePlatform()) void DailyApps.perform({ action: 'browser', url: url.href }).then(result => { if (result.status !== 'opened') api?.toast(result.message || 'The browser could not open.'); }, () => api?.toast('The browser could not open.'));
      else window.open(url.href, '_blank', 'noopener,noreferrer');
    },
    active,
    toast: text => api?.toast(text),
    discardHandoff: () => { pendingHandoff=undefined; if(api?.get('maps').query!=null)api.set({query:null}); },
    handoffReturn: () => !!mapsEventReturnOffered(api?.get('maps').fromEvent,api?.S.stack,screen.isNavigating()),
    released: () => { ++mapRevision; paint(); },
    // With no Maps provider on Android, an event's location can be handed to an installed map
    // app, only when the user taps for it. The exact hand-off text is sent; no route is shown.
    ...(!simulated&&isAndroid ? { mapsApp: {
      available: () => DailyApps.capabilities().then(result => result.actions.some(row => row.action === 'maps' && row.available)),
      open: (text: string) => DailyApps.perform({ action: 'maps', query: text }).then(result => ({ opened: result.status === 'opened', message: result.message })),
    } } : {}),
    deniedLocationHelp: simulated?'Location is unavailable in this preview. Enter coordinates instead.':isAndroid ? 'Allow location in app settings, or enter coordinates.' : 'Allow location in browser site settings, or enter coordinates.',
    publishContext: simulated?undefined:publishMapsSelection,
    clearContext: simulated?undefined:clearMapsSelection,
  });
  const screen=handle.controller;
  // Explicit return to the event whose location opened Maps. It checks that exact event still exists,
  // restores Calendar on it and pops the cross-app stack. It never sets a Maps query.
  let returningToEvent=false;
  const calendarPlugin=registerPlugin<{list(input:{begin:number;end:number}):Promise<{status:string;events?:unknown[]}>}>('AlphaCalendar');
  async function returnToEvent(currentApi:Bag,origin:MapsEventOrigin,raw:unknown){
    if(simulated){currentApi.toast('Checking Calendar is unavailable in this preview.');return;}
    if(returningToEvent)return;returningToEvent=true;
    try{
      // Only a ready read without the event withdraws the control; a refused or failed read keeps it.
      let outcome:'found'|'missing'|'permission'|'unknown'='unknown';
      try{const result=await calendarPlugin.list({begin:origin.begin-1,end:origin.begin+1});outcome=result.status==='ready'?(mapsEventStillThere(origin,result.events)?'found':'missing'):result.status==='permission-required'?'permission':'unknown';}catch{/* A thrown read says nothing about the event. */}
      if(disposed||document.hidden||!currentApi.isActive()||currentApi.get('maps').fromEvent!==raw||!mapsEventReturnOffered(raw,api?.S.stack,screen.isNavigating()))return;
      if(outcome==='permission'){currentApi.toast('Calendar access is needed to check this event. Allow calendar access, then try again.');return;}
      if(outcome==='unknown'){currentApi.toast('The event could not be checked. Maps stays open; try again.');return;}
      if(outcome==='missing'){currentApi.set({fromEvent:null});currentApi.toast('That event was deleted or moved. Maps stays open; nothing else changed.');return;}
      const stack=(api?.S.stack||[]).slice(0,-1);
      // Unwind this visit's Maps layers (route, place, results, search text) as system Back would, so
      // nothing of the hand-off is left to show or replay when Maps is opened again.
      screen.unwind();
      currentApi.setView('calendar',{open:origin.rowId,openDay:origin.day,day:origin.day,month:null,form:null});
      currentApi.open('calendar',{keepState:true});currentApi.shell({stack});
    }finally{returningToEvent=false;}
  }
  module.back = () => screen.back(); module.onLeave = () => screen.release(); module.ongoing = () => null;
  module.reply = () => null;
  module.suggestions = () => !simulated&&mapsConnected() ? ['Help me with this place', 'Explain Maps coverage'] : ['Help me choose a Maps provider', 'Explain location permissions'];
  module.render = (st: Bag, currentApi: Bag) => {
    api = currentApi;
    // Cross-app navigation carries a one-use search, not a selected destination.
    // Consume it outside render and fence it against leaving or a newer action.
    if(typeof st.query==='string'&&st.query.trim()&&!pendingHandoff){
      const handoff=pendingHandoff={query:st.query};
      queueMicrotask(()=>{
        if(pendingHandoff!==handoff)return;pendingHandoff=undefined;
        if(disposed||!currentApi.isActive()||currentApi.get('maps').query!==handoff.query)return;
        const fromEvent=!!currentApi.get('maps').fromEvent;
        currentApi.set({query:null});screen.handoff(handoff.query,fromEvent);
      });
    }
    return {};
  };
  // The shell instance opens Maps for an agent request, exactly as a user's open would.
  let shell: Bag | undefined;
  const renderVals=Component.prototype.renderVals;
  let paletteMode:boolean|undefined, colors:Record<string,string>={};
  const palette=(dark:boolean)=>{
    if(paletteMode===dark)return colors;
    paletteMode=dark;
    colors=dark?{
      land:alphaPaletteColor('--alpha-map-dark-land')!,water:alphaPaletteColor('--alpha-map-dark-water')!,
      park:alphaPaletteColor('--alpha-map-dark-park')!,rwy:alphaPaletteColor('--alpha-map-dark-rwy')!,
      fwyE:alphaPaletteColor('--alpha-map-dark-fwye')!,major:alphaPaletteColor('--alpha-map-dark-major')!,label:alphaPaletteColor('--alpha-map-dark-label')!,
    }:{
      land:alphaPaletteColor('--alpha-map-light-land')!,water:alphaPaletteColor('--alpha-map-light-water')!,
      park:alphaPaletteColor('--alpha-map-light-park')!,rwy:alphaPaletteColor('--alpha-map-light-rwy')!,
      fwyE:alphaPaletteColor('--alpha-map-light-fwye')!,major:alphaPaletteColor('--alpha-map-light-minor')!,label:alphaPaletteColor('--alpha-map-light-label')!,
    };
    return colors;
  };
  // Later adapters also wrap renderVals. Keep this wrapper as a pass-through on disposal.
  Component.prototype.renderVals=function(this:Bag,...args:unknown[]){
    if(!disposed)shell=this;
    const value=renderVals.apply(this,args),open=!disposed&&(simulated||!!this.live)&&this.S().screen==='home'&&this.S().view==='maps';
    if(!open)return {...value,canonicalMapsWorkspace:null};
    api=this.api('maps');
    const region=simulated?null:regionalMap(),event=mapsEventReturnOffered(api!.get('maps').fromEvent,api!.S.stack,screen.isNavigating());
    const currentApi=api!,raw=currentApi.get('maps').fromEvent;
    const host={screen:handle,mapRevision,basemap:region||globalBasemap,colors:palette(currentApi.theme==='dark'),covered:!!value.appHidden,
      agentName:currentApi.name,onAskAgent:(text:string)=>{if(simulated){currentApi.toast('Agent requests are unavailable in this preview.');return;}currentApi.send(text);},onBack:()=>this.goHome(),
      onOpenLocationSettings:()=>{if(!active())return;if(simulated){screen.notify('Location is unavailable in this preview. Enter coordinates instead.');return;}void device.openSettings({page:'privacy'}).catch(()=>{if(active())screen.notify('Location settings could not be opened. Check device or browser permissions, or enter coordinates.');});},
      eventReturn:event?{title:event.title,onReturn:()=>{void returnToEvent(currentApi,event,raw);}}:null,
      disclosure:simulated?'Preview only. Location, routes, sharing and agent actions are unavailable. Saved places stay in this preview.':region?'':describeMapsDisclosure(cloudMapsCoverage()?.disclosure),
      agentNavigation:{offered:agentNavigation.registered(),relay:residentMapsNavigationPort.relay},
    };
    return {...value,legacyView:false,showAppBack:false,canonicalMapsWorkspace:React.createElement(MapsHostContext.Provider,{value:host},React.createElement(MobileViewHost,{registry:alphaViews,view:'maps',active:open,onClose:()=>this.goHome(),onError:(error:unknown)=>{void recordRendererFailure('render',error);},renderError:MapsFailureSurface,fallback:React.createElement('div',{'aria-busy':true,style:mapsSurface})}))};
  };
  // Maps opens only over Home or itself, on an unlocked, visible, non-sensitive launcher screen.
  // Any other app keeps the screen; the agent hears that the phone cannot show Maps now.
  const surface = screen.surface(async () => {
    const showable=()=>{
      const value=shell?.S?.();
      return !disposed&&!document.hidden&&!!shell?.live&&!!value&&value.screen==='home'&&!value.secure&&!value.shade&&!shell.pageSuspended&&
        !shell.props?.assistantSurface&&!connectionController.getSnapshot().open&&(!value.view||value.view==='home'||value.view==='maps');
    };
    if(!showable())return false;
    if(!api?.isActive()){
      shell!.openView('maps');
      await Promise.race([new Promise<void>(resolve=>shell!.setState({},()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,2000))]);
    }
    return showable()&&shell!.S().view==='maps'&&!!api?.isActive()&&!!surface.snapshot();
  });
  // Offered to the agent only while Eliza Cloud Maps is installed for the signed-in account.
  const agentNavigation=bindAgentNavigation({
    // Eliza Cloud Maps in the launcher renderer only; never the regional gateway or the assistant window.
    enabled:()=>!simulated&&!regionalMapsConfigured&&!shell?.props?.assistantSurface&&!document.documentElement.classList.contains('alpha-assistant-surface'),
    installation:()=>{const coverage=cloudMapsCoverage();return coverage&&{providerId:coverage.providerId,attribution:coverage.attribution};},
    connection:mapsConnection,onChange:onMapsConnectionChange,surface,port:residentMapsNavigationPort,
  });
  // Screen-off navigation keeps its voice; everything else retires shared and spoken output.
  const retireShare=()=>screen.retireShare();
  const shareEvents=['launcher-home','alpha:device-state','alpha:dev-incoming-call'];for(const event of shareEvents)window.addEventListener(event,retireShare);
  const visibility = () => { if(document.hidden)screen.hidden();else screen.refresh(); };
  const pagehide=()=>screen.release();window.addEventListener('pagehide', pagehide); document.addEventListener('visibilitychange', visibility);
  return () => { disposed = true; agentNavigation.dispose(); shell=undefined; for(const event of shareEvents)window.removeEventListener(event,retireShare); screen.dispose(); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); Object.assign(module, original); };
}

const mapsSurface={position:'absolute',inset:0,zIndex:21,background:'var(--bg)',color:'var(--fg)'} as React.CSSProperties;
function MapsFailureSurface({label,retry,close,active}:MobileViewFailure){
  const host=React.useContext(MapsHostContext);
  active=active&&!host?.covered;
  return React.createElement('section',{role:'region','aria-label':label,hidden:!active,inert:!active||undefined,style:{...mapsSurface,display:active?'flex':'none',flexDirection:'column',padding:'52px 24px 24px',gap:16}},
    React.createElement('button',{onClick:close,'aria-label':'Back to apps'},'Back to apps'),
    React.createElement('p',{role:'alert'},`${label} could not be shown. Try again, or go back to your apps.`),
    React.createElement('button',{onClick:retry},'Try again'));
}
