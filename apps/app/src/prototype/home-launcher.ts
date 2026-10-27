import {createElement} from 'react';
import type {InstalledApp} from '../native';
import {createLauncher,appKey,filterLauncherApps,describeLauncherApps as sharedDescribe,localFavorites as sharedFavorites,observeLauncher,MAX_FAVORITES,type LauncherBridge,type LauncherSnapshot,type FavoritesStore} from '../../../../.eliza/client-features/plugins/plugin-native-system/src/client/launcher.ts';
import {InstalledAppsLauncher} from '../../../../.eliza/client-features/packages/ui/src/components/pages/InstalledAppsLauncher.tsx';
export {createLauncher,appKey,filterLauncherApps,MAX_FAVORITES};
export type {LauncherBridge,LauncherSnapshot,FavoritesStore};
export const FAVORITES_KEY='alpha.launcher.favorites.v1';
export const localFavorites=(storage:()=>Storage=()=>globalThis.localStorage)=>sharedFavorites(storage,{key:FAVORITES_KEY,defaultPolicy:'alpha-apps'});
export const describeLauncherApps=(apps:InstalledApp[])=>sharedDescribe(apps,{productName:'Alpha Phone',builtinPrefix:'alpha:'});
type Bag=Record<string,any>;
/** Home's All-apps drawer. Shell state (open, query) lives in the model so Back and Home close
 * it; the installed list lives here. */
export function installHomeLauncher(Component: any, bridge: LauncherBridge, options: {icons?: boolean; favorites?: FavoritesStore; /** Exact browser device mirrors only; never infer aliases from labels. */ aliases?: Record<string, string>; /** False when the bridge cannot report package changes; the drawer still re-reads on open and on resume. */ follow?: boolean} = {}) {
  const p = Component.prototype, mount = p.componentDidMount, unmount = p.componentWillUnmount, render = p.renderVals;
  let owner: any = null;
  const builtinRows = new Map<string, Bag>();
  const launcherBridge: LauncherBridge = {...bridge,
    list: options => bridge.list(options),
    launch: target => { const app = builtinRows.get(appKey(target)); if (app) { app.open(); return Promise.resolve(); } return bridge.launch(target); },
    resolveDefault: bridge.resolveDefault ? options => bridge.resolveDefault!(options) : undefined,
    openDefault: bridge.openDefault ? options => bridge.openDefault!(options) : undefined,
  };
  const launcher = createLauncher(launcherBridge, () => owner?.setState({launcherRevision: Date.now()}), {...options, favorites: options.favorites || localFavorites()});
  let stop: (() => void) | undefined;
  p.componentDidMount = function (...args: any[]) {
    owner = this;
    stop = observeLauncher(bridge, launcher, options);
    const result = mount?.apply(this,args);
    if (launcher.snapshot().favorites.some(key=>!key.startsWith('alpha:'))) void launcher.load();
    return result;
  };
  p.componentWillUnmount = function (...args: any[]) {
    stop?.(); launcher.cancelPending(); stop=undefined; if(owner===this)owner=null;
    return unmount?.apply(this,args);
  };
  p.openAllApps = function () { this.setState({drawer: true, drawerQ: ''}); void launcher.load(); };
  p.renderVals = function () {
    const out = render.call(this), S = this.S(), self = this;
    builtinRows.clear();
    const builtins = (out.apps || []).map((app: Bag) => {
      const key = `alpha:${app.key}`;
      builtinRows.set(key, app);
      return {packageName: key, label: app.label};
    });
    launcher.setBuiltins(builtins);
    const snap = launcher.snapshot(), query = String(S.drawerQ || '');
    const details = describeLauncherApps(snap.apps);
    const row = (app: InstalledApp) => {
      const key = appKey(app), parts = details.get(key) || [], name = parts.length ? `${app.label} (${parts.join(', ')})` : app.label, favorite = snap.favorites.includes(key);
      return {
        key, d: builtinRows.get(key)?.d || out.ic?.grid || '', label: app.label, sub: parts.join(' · '), hasSub: parts.length > 0, aria: `Open ${name}`, hasIcon: !!app.icon, noIcon: !app.icon, icon: app.icon || '',
        busy: snap.launching === key, disabled: !!snap.launching,
        open: () => void launcher.launch(app),
        favorite, favoriteAria: favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`, favoriteFill: favorite ? 'currentColor' : 'none', favoriteColor: favorite ? 'var(--fg)' : 'var(--mut)',
        toggleFavorite: () => launcher.toggleFavorite(app),
      };
    };
    const homeApps = launcher.favoriteApps().map(app => {
      const builtin = builtinRows.get(appKey(app));
      return builtin ? {...builtin, hasIcon: false, noIcon: true} : {...row(app), badge: false};
    });
    const installedAppsLauncher=createElement('div',{
      'data-alpha-layer':'drawer',role:'dialog','aria-modal':true,'aria-label':'All apps',className:'alpha-app-drawer fadein',
      style:{position:'absolute',inset:'44px 0 0',zIndex:30,background:'var(--bg)',color:'var(--fg)',display:'flex',flexDirection:'column',padding:'12px 0 108px',boxSizing:'border-box'},
    },createElement(InstalledAppsLauncher,{
      launcher,query,onQuery:value=>{launcher.clearError();self.setState({drawerQ:value});},onClose:()=>self.setState({drawer:false,drawerQ:''}),productName:'Alpha Phone',builtinPrefix:'alpha:',
      style:{flex:1,'--launcher-background':'var(--bg)','--launcher-foreground':'var(--fg)','--launcher-muted':'var(--mut)','--launcher-surface':'var(--s2)','--launcher-title-font':"'Denton','Fraunces',Georgia,serif",'--launcher-title-weight':'300'} as any,
      renderIcon:app=>createElement('svg',{className:'i',viewBox:'0 0 24 24','aria-hidden':true},createElement('path',{d:builtinRows.get(appKey(app))?.d||out.ic?.grid||''})),
    }));
    return {...out, apps: homeApps, drawerOpen: !!S.drawer && !!out.isOn && !out.isView, installedAppsLauncher,launcher:{open:()=>self.openAllApps()}};

  };
  return launcher;
}
