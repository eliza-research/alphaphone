/** Temporary domain-view adapter: session, approvals and turn cancellation retain
 * their current owners while the common application owns actual screen placement. */
import {useMemo, type ReactNode, type CSSProperties} from 'react';
import type {LauncherBridge} from '@elizaos/capacitor-system/launcher';
import {createMobileApplicationCatalog, MobileApplication, registerAppShellPage, listAppShellPages, type MobileShellNavigationAction} from '@elizaos/ui/mobile-shell';
import {ALPHA_PRODUCT, alphaCanonicalViewId, alphaViewKey, alphaViewPath} from './alpha-product';
import {isMvpView} from '../prototype/mvp-features';

type Bag = Record<string, any>;
interface Parts {hostProps: Bag; screenProps: Bag; header: ReactNode; cards: ReactNode; view: ReactNode; assistant: ReactNode; overlays: ReactNode}

/** Register real compatibility implementations in the same registry that shared views use. */
export function registerCompatibilityViews(views:Bag) {
  const registered=new Set(listAppShellPages().map(page=>page.agentViewId ?? page.id));
  for (const [host, definition] of Object.entries(views)) {
    const id=alphaCanonicalViewId(host);
    if(registered.has(id))continue;
    registerAppShellPage({id,agentViewId:id,pluginId:'@elizaos/mobile-compatibility',label:definition.label ?? definition.title ?? host,path:alphaViewPath(host)});
  }
}

export function AlphaMobileApplication({vals,model,parts,views,bridge,installedIcons,followInstalledApps,browserApps}: {vals:Bag;model:Bag;parts:Parts;views:Bag;bridge:LauncherBridge;installedIcons:boolean;followInstalledApps:boolean;browserApps?: readonly {packageName:string;view?:string}[]}) {
  const catalog = useMemo(() => {
    return createMobileApplicationCatalog(ALPHA_PRODUCT, listAppShellPages, {available:page=>isMvpView(alphaViewKey(page.agentViewId ?? page.id) ?? page.id)});
  }, [views]);
  const aliases = useMemo(() => browserApps ? Object.fromEntries(browserApps.flatMap(app=>{
    const page=app.view ? catalog.find(app.view) : undefined;
    return page ? [[app.packageName,catalog.launcherKey(page)]] : [];
  })) : undefined, [browserApps,catalog]);
  const navigate = (action:MobileShellNavigationAction) => {
    if(action.type==='open') { const key=alphaViewKey(action.view); if(key)model.openView(key,undefined,action.assistant,{push:action.history==='push'}); }
    else if(action.type==='home')model.goHome(action.assistant);
    else if(action.type==='back')model.back();
    else model.setState(model.shellNavigate(action));
  };
  const state=model.S();
  const {key:hostKey,...hostProps}=parts.hostProps;
  const {key:screenKey,...screenProps}=parts.screenProps;
  return <div {...hostProps}>
    <MobileApplication {...screenProps} catalog={catalog} bridge={bridge}
      appearance={(state.theme || model.props.theme)==='dark'?'dark':'light'}
      navigation={model.shellNav()} navigate={navigate} aliases={aliases}
      installedIcons={installedIcons} followInstalledApps={followInstalledApps}
      homeCovered={!vals.isOn || !!vals.homeHidden || !!vals.assistantSurface}
      home={{header:vals.isOn?parts.header:null,cards:vals.isOn?parts.cards:null,onFocusCapture:vals.focusAppContent,'data-alpha-layer':'home',style:{inset:'44px 0 0',zIndex:10,scrollPaddingBottom:110,visibility:vals.isOn&&!vals.assistantSurface?undefined:'hidden'},layoutProps:{'data-alpha-home-layout':''},cardsProps:{className:'scr'},gridProps:{'data-alpha-home-apps':''},clearanceProps:{'data-alpha-home-clearance':''}}}
      homeTiles={tiles=>vals.assistantSurface?[]:tiles.map(tile=>{const page=catalog.fromLauncherKey(tile.key);const key=page&&alphaViewKey(page.id);const definition=key&&views[key];return {...tile,badge:!!(key&&['phone','messages','inbox'].includes(key)&&typeof definition?.badge==='function'&&definition.badge(model.vget(key)))};})}
      drawerProps={{'data-alpha-layer':'drawer',className:'alpha-app-drawer fadein',style:{inset:'44px 0 0',zIndex:30,padding:'12px 0 108px'},inventoryStyle:{'--launcher-title-weight':'300'} as CSSProperties}}
      retainedViews={vals.canonicalNotesWorkspace} renderView={()=>vals.isOn?parts.view:null}
      assistant={parts.assistant} overlays={parts.overlays}/>
  </div>;
}
