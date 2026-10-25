import { AuthCodeDialog } from './runtime/auth-code-dialog';
// Register browser implementations before any runtime module claims plugin identity.
import './browser/register';
import {bindBrowserSpeechConnection} from './browser/agent-speech';
import { pauseLiveActivityForMock } from './runtime/mock-admission';
import { installBrowserDeviceAdapter } from './browser/device-adapter';
import { BrowserDeviceControls } from './browser/device-controls';
import { browserDevProfile,developmentAgentWorkflows } from './browser/dev-profile';
import { captureSimulatedApps, installSimulatedApps } from './browser/simulated-apps';
import {HostedDigestPanel} from './runtime/hosted-digest-ui';
import { installClockAdapter } from './prototype/clock-adapter';
import { installNotesDocumentAdapter } from './prototype/notes-document-adapter';
import { installPrototypeMapsAdapter } from './prototype/maps-adapter';
import { installNotificationsAdapter } from './prototype/notifications-adapter';
import { installWorkflowAdapter } from './prototype/workflow-adapter';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Component, VIEWS } from './prototype/model.js';
import { installReminderAdapter } from './prototype/reminder-adapter';
import { installAgentAdapter } from './prototype/agent-adapter';
import { installPrototypeNativeAdapters } from './prototype/native-adapter';
import { installSelectedDocumentAdapter } from './prototype/selection-adapter';
import { installPrototypeCameraAdapter } from './prototype/camera-adapter';
import { installPrototypeHomeBindings, installPrototypeDataAdapter } from './prototype/data-adapter';
import { isMvpView } from './prototype/mvp-features';
import { installPrototypeContactsAdapter } from './prototype/contacts-adapter';
import { isAndroid } from './native';
import { DailyApps } from './daily';
import { installPrototypeVoiceAdapter } from './prototype/voice-adapter';
import { installPrototypeBrowserAdapter } from './prototype/browser-adapter';
import { installCalendarAdapter } from './prototype/calendar-adapter';
import { installSettingsAdapter } from './prototype/settings-adapter';
import { ConnectionChooser, connectionController } from './runtime/connection-ui';
import { installInboxCloudAdapter } from './prototype/inbox-cloud-adapter';
import './prototype/prototype.css';
import './prototype/phone.css';
if(!isAndroid)bindBrowserSpeechConnection(connectionController);
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('native-phone', isAndroid);
const savedMock = (() => {
  try { return isAndroid && JSON.parse(localStorage.getItem('alpha.connection.selection.v1') || 'null')?.kind === 'mock'; }
  catch { return false; }
})();
// Resolve mock before mounting any native adapter, including after a cold start.
const mock = query.get('mode') === 'mock' || savedMock;
const fixture = mock || (import.meta.env.DEV && !isAndroid && query.get('fixture') === '1');
const initialTheme = (() => {
  if (query.has('theme') || fixture) return query.get('theme') === 'dark' ? 'dark' : 'light';
  try { return localStorage.getItem('alpha.appearance.v1') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
})();
document.documentElement.dataset.connectionMode = mock ? 'mock' : 'live';
const simulatedApps=captureSimulatedApps(VIEWS);
installPrototypeHomeBindings(Component);
if (!fixture) {
  let selected: ReturnType<typeof installSelectedDocumentAdapter> | undefined;
  installPrototypeNativeAdapters(Component, VIEWS, { onSelection: (module, result, api) => { void selected?.(module, result, api); } });
  installPrototypeMapsAdapter(Component, VIEWS);
  selected = installSelectedDocumentAdapter(Component, VIEWS);
  installPrototypeCameraAdapter(Component, VIEWS);
  // Deferred by September 15 MVP notes; retain adapter source and user data.
  if (isMvpView("contacts")) installPrototypeContactsAdapter(Component, VIEWS);
  installAgentAdapter(Component, VIEWS);
  installReminderAdapter(Component, VIEWS);
  installCalendarAdapter(Component, VIEWS);
  installPrototypeDataAdapter(Component, VIEWS);
  installNotificationsAdapter(Component);
  installPrototypeVoiceAdapter(Component, VIEWS);
  installNotesDocumentAdapter(Component, VIEWS);
  installPrototypeBrowserAdapter(Component, VIEWS);
  installSettingsAdapter(Component, VIEWS);
  if(!isAndroid)installBrowserDeviceAdapter(Component);
  if(!browserDevProfile) installInboxCloudAdapter(Component, VIEWS);
  if(!browserDevProfile) installWorkflowAdapter(Component, VIEWS);
}
installSimulatedApps(Component,VIEWS,simulatedApps);
if(developmentAgentWorkflows)installWorkflowAdapter(Component,VIEWS);
installClockAdapter(Component, VIEWS, { simulated: fixture, browser: !isAndroid });
let shell: any;
function Phone() {
  useEffect(() => {
    if (isAndroid) void DailyApps.surfaceInfo().then(info => {
      if (Number.isFinite(info.topInset)) document.documentElement.style.setProperty('--native-top-inset', `${info.topInset}px`);
      if (Number.isFinite(info.bottomInset)) document.documentElement.style.setProperty('--native-bottom-inset', `${info.bottomInset}px`);
    }).catch(() => {});
    const size = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      const desktop = !isAndroid && window.innerWidth > 600;
      const banner = mock ? document.querySelector('.mock-mode-banner')?.getBoundingClientRect().height || 36 : 0;
      const tools = import.meta.env.DEV && !isAndroid && !mock ? document.querySelector<HTMLElement>('.alpha-dev-tools') : null;
      const toolsInset = tools ? Math.max(56, Math.ceil(tools.getBoundingClientRect().height + (parseFloat(getComputedStyle(tools).bottom) || 0) + 2)) : 0;
      const available = Math.max(1, height - banner - (desktop ? 48 : 0) - toolsInset);
      const scale = desktop ? Math.min(1, available / 915) : window.innerWidth / 412;
      document.documentElement.style.setProperty('--phone-scale', String(scale));
      document.documentElement.style.setProperty('--phone-height', `${desktop ? 915 : available / scale}px`);
      document.documentElement.style.setProperty('--phone-left', `${desktop ? (window.innerWidth - 412 * scale) / 2 : 0}px`);
      document.documentElement.style.setProperty('--phone-top', `${banner + (desktop ? 24 : 0)}px`);
      document.documentElement.classList.toggle('browser-desktop', desktop);
    };
    const bannerObserver=new ResizeObserver(size);const bannerElement=document.querySelector('.mock-mode-banner');if(bannerElement)bannerObserver.observe(bannerElement);
    size(); window.addEventListener('resize', size); window.visualViewport?.addEventListener('resize', size);
    return () => { bannerObserver.disconnect(); window.removeEventListener('resize', size); window.visualViewport?.removeEventListener('resize', size); };
  }, []);
  return <>{import.meta.env.DEV&&!isAndroid&&!mock&&<BrowserDeviceControls command={action=>{
    if(!shell)return;
    if(action==='home')window.dispatchEvent(new Event('launcher-home'));
    else if(action==='back')window.dispatchEvent(new Event('alpha-back',{cancelable:true}));
    else if(action==='power'){shell.leave();shell.power();}
    else if(action==='unlock'){shell.unlock();window.dispatchEvent(new Event('focus'));}
    else if(action==='boot'){shell.leave();shell.runBoot();}
    else if(action==='shade'){shell.unlock();shell.setState({shade:true});}
    else if(action==='assistant'){shell.unlock();shell.setState({chat:'full'});}
    else if(action==='background'){shell.leave();shell.setState({screen:'off',voice:'off',chat:'input',shade:false});document.documentElement.dataset.devBackground='true';window.dispatchEvent(new Event('blur'));}
    else if(action==='resume'){delete document.documentElement.dataset.devBackground;shell.unlock();window.dispatchEvent(new Event('focus'));}
    if(['power','unlock','boot','background','resume'].includes(action))window.dispatchEvent(new Event('alpha:device-state'));
  }}/>}{mock && <div className="mock-mode-banner" role="status"><span>Mock mode · simulated data and actions</span><button onClick={() => { void connectionController.offline().then(() => { const url = new URL(location.href); url.searchParams.delete('mode'); url.searchParams.delete('start'); location.assign(url.href); }); }}>Exit mock mode</button></div>}<Component phoneSurface nativeSystemChrome={isAndroid} initial={fixture ? query.get('start') || 'home' : 'home'} theme={initialTheme} ref={(value: any) => { shell = value; }} />
{!fixture && <><ConnectionChooser /><HostedDigestPanel /><AuthCodeDialog /></>}</>;
}
async function mountPhone() {
  if (mock && isAndroid) {
    const root=document.getElementById('root')!;
    root.setAttribute('role','status');
    root.textContent='Pausing live background activity before opening mock mode…';
    try { await pauseLiveActivityForMock(); }
    catch {
      root.setAttribute('role','alert');
      root.textContent='Live background activity could not be paused. Retry before opening mock mode.';
      const retry=document.createElement('button');retry.textContent='Retry mock mode';
      retry.onclick=()=>{retry.disabled=true;void mountPhone();};root.append(retry);return;
    }
    root.removeAttribute('role');
  }
  createRoot(document.getElementById('root')!).render(<Phone />);
}
void mountPhone();
