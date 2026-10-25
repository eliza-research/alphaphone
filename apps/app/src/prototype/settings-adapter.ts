import {browserDevProfile} from '../browser/dev-profile';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import { DailyApps } from '../daily';
import { connectionController } from '../runtime/connection-ui';

type Bag = Record<string, any>;
const device = registerPlugin<{
  snapshot(): Promise<Bag>;
  openPasswordProvider(input:{action:string}):Promise<{status:string;destination?:string}>;
  openSettings(input: { page: string }): Promise<{ status: string }>;
  setTextScale(input:{percent:number}):Promise<{textScalePercent:number;effectiveTextZoom:number}>;
}>('AlphaDevice');
const notifications = registerPlugin<{status():Promise<Bag>;openAppSettings():Promise<Bag>;openChannelSettings(input:{id:string}):Promise<{status:string}>;crossAppStatus():Promise<Bag>;notificationApps():Promise<{apps:Bag[]}>;setNotificationPolicy(input:Bag):Promise<Bag>;resumeCrossApp(input:{expectedRevision:string}):Promise<Bag>;openNotificationAccess():Promise<Bag>;notificationHistory():Promise<{items:Bag[]}>;clearNotificationHistory():Promise<void>}>('AlphaNotifications');
const speech = registerPlugin<{localSpeechStatus(input:{requestId:string}):Promise<{ready:boolean;execution:string}>}>('AlphaVoiceCloud');
const system = registerPlugin<{ getDeviceSettings(): Promise<Bag> }>('ElizaSystem');

/** Keep the reference settings components; never present fixture device facts. */
export function installSettingsAdapter(Component: any, views: Bag) {
  const definition = views.settings, render = definition.render, p = Component.prototype;
  const mount = p.componentDidMount, unmount = p.componentWillUnmount, openView = p.openView, update = p.componentDidUpdate;
  let owner: any, facts: Bag = {}, controls: Bag = {}, delivery: Bag = {}, generation = 0,scaleGeneration=0, cross:Bag={}, choices:Bag[]|null=null, history:Bag[]|null=null, notificationBusy=false;
  let passwordOpening=false;
  let capabilityAbort: AbortController | null = null;
  let gmail = 'Not checked', digests = 'Not checked', localSpeech = 'Not checked', speechChecking = false, speechGeneration = 0;
  const changed = () => owner?.vset('settings', { capabilityReadAt: Date.now() });
  async function refreshCapabilities() {
    capabilityAbort?.abort(); const abort = capabilityAbort = new AbortController();
    const cloud = connectionController.getCloudClient(), workflow = connectionController.getWorkflowClient(), instance = owner;
    gmail = cloud ? 'Checking authorization…' : 'Cloud sign-in required';
    digests = workflow ? 'Checking agent support…' : 'Connect an agent';
    localSpeech = 'Not checked'; speechChecking = false; ++speechGeneration; changed();
    const timeout = setTimeout(() => { abort.abort(); if (owner === instance && capabilityAbort === abort) { if (gmail === 'Checking authorization…') gmail = 'Authorization not verified'; if (digests === 'Checking agent support…') digests = 'Agent support not verified'; changed(); } }, 10000);
    try {
      await Promise.allSettled([
        (async () => {
          if (!cloud) return;
          try {
            const accounts = await cloud.client.gmailAccounts(abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getCloudClient()?.sessionId !== cloud.sessionId) return;
            gmail = accounts.some(a => a.connected && a.grantedCapabilities.includes('google.gmail.triage')) ? 'Read access authorized' : 'Authorization required';
          } catch { if (owner === instance && capabilityAbort === abort) gmail = 'Authorization not verified'; }
        })(),
        (async () => {
          if (!workflow) return;
          try {
            const available = await workflow.client.hosted().available(abort.signal);
            if (abort.signal.aborted || owner !== instance || capabilityAbort !== abort || connectionController.getWorkflowClient()?.sessionId !== workflow.sessionId) return;
            digests = available ? 'Supported by selected agent' : 'Unavailable on selected agent';
          } catch { if (owner === instance && capabilityAbort === abort) digests = 'Agent support not verified'; }
        })(),
      ]);
    } finally { clearTimeout(timeout); if (owner === instance && capabilityAbort === abort) changed(); }
  }
  async function checkSpeech() {
    if (speechChecking) return;
    const instance = owner, token = ++speechGeneration;
    speechChecking = true; localSpeech = 'Checking on this phone…'; changed();
    try {
      const status = await speech.localSpeechStatus({requestId:crypto.randomUUID()});
      if (owner === instance && token === speechGeneration) localSpeech = status.ready === true && status.execution === (Capacitor.isNativePlatform()?'device':'browser') ? (Capacitor.isNativePlatform()?'Last check: ready on this phone':'Browser audio ready') : 'Last check: not ready';
    } catch { if (owner === instance && token === speechGeneration) localSpeech = 'Not ready; try again'; }
    finally { if (owner === instance && token === speechGeneration) { speechChecking = false; changed(); } }
  }
  async function refresh() {
    const instance = owner, token = ++generation;
    if (!instance) return;
    const [state, settings, noticeState, crossState, metadata] = await Promise.allSettled([device.snapshot(), system.getDeviceSettings(), notifications.status(), notifications.crossAppStatus(), history===null?Promise.resolve(null):notifications.notificationHistory()]);
    if (owner !== instance || generation !== token) return;
    facts = state.status === 'fulfilled' ? state.value : {};
    controls = settings.status === 'fulfilled' ? settings.value : {};
    delivery = noticeState.status === 'fulfilled' ? noticeState.value : {};
    cross = crossState.status === 'fulfilled' ? crossState.value : {};
    if(metadata.status==='fulfilled'&&metadata.value!==null)history=metadata.value.items;
    instance.vset('settings', { nativeReadAt: Date.now() });
  }
  p.componentDidMount = function () {
    mount.call(this); owner = this; void refresh(); void refreshCapabilities();
    let lastBinding = JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId]);
    this.settingsConnectionUnsubscribe = connectionController.subscribe(() => {
      this.vset('settings', { connectionReadAt: Date.now() });
      const next = JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId]);
      if (next !== lastBinding) { lastBinding = next; void refreshCapabilities(); }
    });
    this.deviceResume = DailyApps.addListener('appResumed', () => { void refresh(); void refreshCapabilities(); }).catch(() => null);
  };
  p.componentDidUpdate = function (previousProps: Bag, previousState: Bag) {
    update?.call(this, previousProps, previousState);
    const theme = this.state?.theme;
    if ((theme === 'light' || theme === 'dark') && theme !== previousState?.theme) {
      try { localStorage.setItem('alpha.appearance.v1', theme); }
      catch { this.toast('Theme changed for this session, but could not be saved.'); }
    }
  };
  p.componentWillUnmount = function () {
    if (owner === this) { capabilityAbort?.abort(); capabilityAbort = null; ++speechGeneration; owner = null; ++generation; facts = {}; controls = {}; delivery = {}; cross={}; choices=null; history=null; }
    this.settingsConnectionUnsubscribe?.();
    void this.deviceResume?.then((listener: any) => listener?.remove()); unmount.call(this);
  };
  p.openView = function (key: string, ...args: any[]) {
    const result = openView.call(this, key, ...args);
    if (key === 'settings') { void refresh(); void refreshCapabilities(); }
    return result;
  };
  definition.render = (state: Bag, api: Bag) => {
    const out = render({ ...state, acct: null, adding: false, sheet: ['conn', 'voice'].includes(state.sheet?.kind) ? null : state.sheet }, api);
    // Prototype personality values are mock-only until the agent reports them.
    out.persona = 'Voice and agent settings';
    const connection = connectionController.getSnapshot();
    const account = connection.cloudAccount;
    const target = connection.session ? connection.name : 'Not connected';
    const runtimeLocation=!connection.session?'Not connected':connection.kind==='resident'?(Capacitor.isNativePlatform()?'On this device':'On this computer · development'):'Remote agent';
    const cloudLabel = account ? `${account.environment} · ${account.userId.slice(0, 8)}` : 'Not signed in';
    const manage = (page: string) => () => void device.openSettings({ page }).catch(() => api.toast('This Android settings page is unavailable.'));
    const info = (label: string, val: string): Bag => ({ kInfo: true, label, val, hasVal: true, noAB: true });
    const nav = (label: string, page: string): Bag => ({ kNav: true, label, lbl: label, chev: true, noAB: true, go: manage(page) });
    const group = (rows: Bag[]) => ({ css: 'background:var(--s2);padding:4px 0', rows });
    const percent = typeof facts.batteryPercent === 'number' ? `${facts.batteryPercent}%` : 'Unavailable';
    const active = (key: string) => typeof facts[key] === 'boolean' ? facts[key] ? 'Active connection' : 'Not active' : 'Unavailable';
    const topValues: Bag = {
      'Wi-Fi': active('wifiActive'), 'Bluetooth': Capacitor.isNativePlatform()?'Manage in Android':active('bluetoothActive'), 'Mobile data': active('cellularActive'),
      'Accounts': account ? 'Alpha Phone connected' : 'Not signed in', 'Connections': gmail,
      'Privacy & Enclave': runtimeLocation,
      'Battery': percent, 'Models': target, 'About': facts.appVersion || 'Unavailable',
      'Notifications': typeof delivery.appEnabled !== 'boolean' ? 'Unavailable' : !delivery.appEnabled || !delivery.permissionGranted ? 'App notifications off' : delivery.channels?.some((c:Bag)=>c.blocked||c.groupBlocked) ? 'Some channels blocked' : 'App notifications allowed',
      'Sound & vibration': Capacitor.isNativePlatform()?'Android settings':'Browser device settings',
    };
    for (const page of out.stack) {
      if (page.isTop) {
        const native=Capacitor.isNativePlatform(), provider=facts.passwordProvider||{};
        const installation:Bag={installed:'Installed · publisher verified',disabled:'Installed but disabled',absent:'Not installed','unrecognized-publisher':'Installed · publisher not recognized',unknown:'Not checked'};
        const selection:Bag={proton:provider.installation==='installed'?'Proton Pass selected':provider.installation==='disabled'?'Proton Pass selected · app disabled':'Provider package selected · publisher not verified',other:'Another provider selected',none:'No provider selected',unknown:'Selection unavailable'};
        const action=(label:string,kind:string):Bag=>({kNav:true,label,lbl:passwordOpening?'Opening…':label,chev:true,noAB:true,go:async()=>{
          if(passwordOpening)return;passwordOpening=true;const instance=owner;changed();
          try{const result=await device.openPasswordProvider({action:kind});if(result?.status!=='opened')throw Error('Unconfirmed provider handoff');if(owner===instance&&result.destination!=='development')api.toast(result.destination==='system-settings'?'Opened Android settings. Search for passwords or autofill, then choose your provider.':'Opened provider setup. Complete or cancel there; no change is confirmed yet.');}
          catch{if(owner===instance)api.toast('Password provider setup is unavailable. No provider change is confirmed.');}
          finally{passwordOpening=false;if(owner===instance){changed();void refresh();}}
        }});
        const passwordGroup=group(browserDevProfile?[
          info('Provider',provider.installation==='installed'?'Development provider installed':'Not installed'),
          info('Selection',provider.selection==='proton'?'Development provider selected':'No provider selected'),
          info('Autofill','Sample sign-in in the development vault'),
          action('Choose password provider','settings'),
          provider.installation==='installed'?action('Open development vault','open'):action('Add development provider','install'),
        ]:[
          info('Proton Pass',native?(installation[provider.installation]||'Status unavailable'):'Managed by your browser and operating system'),
          info('Selection',native?(selection[provider.selection]||'Selection unavailable'):'Native provider status is unavailable here'),
          info('Autofill',native?(provider.support==='available'?'Available on this device':provider.support==='unavailable'?'Unavailable for this device or user':'Availability not checked'):'Use your browser’s password settings'),
          info('Vault','Confirm unlock, saved passwords and filling in your provider.'),
          info('Compatibility','Proton may show a browser warning. Check the website address before filling.'),
          ...(native?[action('Choose password provider in Android','settings'),...(provider.installation==='installed'?[action('Open Proton Pass','open')]:provider.installation==='absent'?[action('Get Proton Pass from Proton','install')]:[]),{kNav:true,label:'Refresh password provider status',lbl:'Refresh password provider status',chev:true,noAB:true,go:()=>void refresh()}]:[]),
        ]);
        page.groups.push(group([{kNav:true,label:'Password manager',lbl:'Password manager',chev:true,noAB:true,go:()=>api.set({page:'password-provider'})}]));
        if(state.page==='password-provider')out.stack.push({isTop:false,notTop:true,cls:'enter',z:4,title:'Password manager',hasTitle:true,backLabel:'Back to Settings',back:()=>api.set({page:null}),hero:{},groups:[passwordGroup]});
        page.groups.push(group([{kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))}]));
        page.groups.push(group([{kNav:true,label:'Agent connection',lbl:'Agent connection',val:connectionController.getSnapshot().name,hasVal:true,chev:true,noAB:true,go:()=>connectionController.open()}]));
        page.groups.push(group([{kNav:true,label:'Try mock mode',lbl:'Try mock mode',chev:true,noAB:true,go:()=>connectionController.mock()}]));
        for (const g of page.groups) for (const row of g.rows) if (row.label in topValues) {
          row.val = topValues[row.label]; row.hasVal = true;
          if(row.label==='Privacy & Enclave'){row.label='Privacy & runtime';row.lbl=row.label;}
        }
        continue;
      }
      if (page.title === 'Accounts') {
        page.groups = [group([info('Alpha Phone account', cloudLabel), { kNav:true, label:'Manage Alpha Phone account', lbl:'Manage Alpha Phone account', chev:true, noAB:true, go:()=>connectionController.open() }, nav('Device accounts in Android', 'accounts')])];
      } else if (page.title === 'Connections') {
        page.groups = [group([info('Gmail', gmail), { kNav:true, label:'Open Inbox', lbl:'Open Inbox', chev:true, noAB:true, go:()=>api.open('inbox') }, info('Other connectors', 'Not connected')])];
      } else if (state.page === 'character' && page.hero?.kChar === true) {
        // The reference character page deliberately has no visible title.
        page.groups = browserDevProfile?[group([
          info('Speech','Record and review in this browser'),
          {kNav:true,label:'Wake assistant',lbl:'Wake assistant',chev:true,noAB:true,go:()=>void owner?.startVoice()},
          {kNav:true,label:'Open conversation',lbl:'Open conversation',chev:true,noAB:true,go:()=>api.composeContentQuestion('')},
          {kNav:true,label:'Agent connection',lbl:'Agent connection',chev:true,noAB:true,go:()=>connectionController.open()},
          {kNav:true,label:'Scheduled digests',lbl:'Scheduled digests',chev:true,noAB:true,go:()=>window.dispatchEvent(new Event('alpha:hosted-digests'))},
        ])]:[group([info('Cloud speech', account ? 'Check in voice controls' : 'Cloud sign-in required'), info('Wake word', 'Not available'), { kNav:true, label:'Scheduled digests', lbl:'Scheduled digests', val:digests, hasVal:true, chev:true, noAB:true, go:()=>window.dispatchEvent(new Event('alpha:hosted-digests')) }, info('Personality settings', 'Managed by your agent')])];
      } else if (page.title === 'Battery') {
        page.hero = { ...page.hero, big: percent, sub: facts.readAt ? facts.charging ? 'Charging' : 'On battery' : 'Device reading unavailable', hasMeter: typeof facts.batteryPercent === 'number', meter: facts.batteryPercent ?? 0 };
        page.groups = [group([info('Battery saver', typeof facts.powerSave === 'boolean' ? facts.powerSave ? 'On' : 'Off' : 'Unavailable'), nav('Manage battery in Android', 'battery')])];
      } else if (page.title === 'About') {
        page.hero = { ...page.hero, big: facts.model || 'This phone', sub: facts.manufacturer || 'Device information unavailable' };
        page.groups = [group([
          info('Alpha Phone', facts.appVersion || 'Unavailable'), info('Android', facts.androidRelease || 'Unavailable'),
          info('Build', facts.build || 'Unavailable'), info('Security patch', facts.securityPatch || 'Unavailable'),
          info('Agent execution', runtimeLocation), info('Agent', target), info('Inference model', 'Not reported by agent'),
        ]), group([nav('Android device information', 'about')])];
      } else if (page.title === 'Wi-Fi') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.hero = { ...page.hero, big: active('wifiActive'), sub: 'Wi-Fi transport · network names stay in Android settings' };
        page.groups = [group([nav('Manage Wi-Fi networks', 'wifi')])];
      } else if (page.title === 'Bluetooth') {
        page.hasHdrTog = false; page.hdrTog = null;
        page.groups = [group([info('Device connections', 'Manage in Android'), nav('Pair or manage devices', 'bluetooth')])];
      } else if (page.title === 'Mobile data') {
        page.groups = [group([info('Mobile connection', active('cellularActive')), nav('Manage mobile networks', 'mobile')])];
      } else if (page.title === 'Models') {
        page.hero = { ...page.hero, big: target, sub: 'Conversation uses the selected agent; speech can run on this phone' };
        page.groups = [group([info('Connection', connection.kind), info('Inference model', 'Not reported by agent'), info('On-device speech', localSpeech), { kNav:true, label:'Check on-device speech', lbl:speechChecking?'Checking speech…':'Check on-device speech', chev:true, noAB:true, go:()=>void checkSpeech() }])];
      } else if (page.title === 'Developer') {
        page.groups = [group([info('App version', facts.appVersion || 'Unavailable'), info('Device uptime', typeof facts.uptimeMs === 'number' ? `${Math.floor(facts.uptimeMs / 60000)} min` : 'Unavailable'), info('NPU usage', 'Unavailable'), info('Agent memory', 'Not connected')]), group([nav('Android developer settings', 'developer')])];
      } else if (page.title === 'Notifications') {
        const custom = (label:string,go:()=>void):Bag=>({kNav:true,label,lbl:label,chev:true,noAB:true,busy:notificationBusy,hasVal:notificationBusy,val:'Working…',go:()=>{if(!notificationBusy)go();}});
        const run = async (task:()=>Promise<void>)=>{if(notificationBusy)return;notificationBusy=true;changed();const current=owner;try{await task();if(owner===current)await refresh();}catch{if(owner===current)api.toast('Notification settings changed or are unavailable. Refresh and try again.');}finally{notificationBusy=false;if(owner===current)changed();}};
        const policy = (changes:Bag)=>void run(async()=>{await notifications.setNotificationPolicy({expectedRevision:cross.revision,...changes});if(changes.history===false)history=[];});
        const selected:Bag[]=cross.apps||[];
        const crossRows:Bag[]=[info('Other apps',typeof cross.accessGranted!=='boolean'?'Unavailable':!cross.enabled?'Collection off':cross.paused?'Paused after mock mode':!cross.accessGranted?'Android access not granted':!cross.connected?'Waiting for Android listener':'Selected apps connected'),info('Notification privacy',Capacitor.isNativePlatform()?'Android grants broad access. Alpha reads only selected apps; previews and history are separate choices.':'Development events are stored in this browser. Previews and metadata history are separate choices.'),info('Agent access','Notification content is not sent to your agent')];
        if(cross.revision){
          crossRows.push(custom(cross.enabled?'Turn off other-app collection':'Enable selected-app collection',()=>{
            if(Capacitor.isNativePlatform()&&!cross.enabled&&!window.confirm('Enable collection for your selected apps? Android grants broad notification access. Alpha filters to your selection before reading text. Previews and local metadata history remain separate choices.'))return;
            policy({enabled:!cross.enabled});
          }),custom(Capacitor.isNativePlatform()?'Manage notification access in Android':'Manage development notification access',()=>void run(async()=>{await notifications.openNotificationAccess();})),custom(choices?'Hide app choices':'Choose notification apps',()=>{
            if(choices){choices=null;owner?.vset('settings',{notificationChanged:Date.now()});return;}
            void run(async()=>{const next=await notifications.notificationApps();choices=next.apps;});
          }));
          if(cross.paused)crossRows.push(custom('Resume selected-app collection',()=>void run(async()=>{if(window.confirm('Resume collection of notifications from your selected apps?'))await notifications.resumeCrossApp({expectedRevision:cross.revision});})));
          for(const app of selected)crossRows.push(info(app.label,app.available===false?'App changed: remove and select again':app.preview?'Current title and text allowed':'Content hidden'),custom(`Remove ${app.label}`,()=>policy({apps:selected.filter(a=>a.packageName!==app.packageName).map(({packageName,preview})=>({packageName,preview}))})),custom(`${app.preview?'Hide':'Allow'} previews: ${app.label}`,()=>{
            if(Capacitor.isNativePlatform()&&!app.preview&&!window.confirm(`Allow current notification titles and text from ${app.label} while unlocked? They stay on this phone and are not stored in history or sent to the agent.`))return;
            policy({apps:selected.map(a=>({packageName:a.packageName,preview:a.packageName===app.packageName?!app.preview:a.preview}))});
          }));
          for(const app of choices||[])if(!selected.some(a=>a.packageName===app.packageName))crossRows.push(custom(`Select ${app.label} (${app.packageName})`,()=>policy({apps:[...selected.map(({packageName,preview})=>({packageName,preview})),{packageName:app.packageName,preview:false}]})));
          crossRows.push(info('Local metadata history',cross.historyUnavailable?'Unavailable; clear local history to reset':cross.history?'On · 100 events, 24 hours · no message text':'Off'),custom(cross.history?'Turn off local metadata history':'Enable local metadata history',()=>{
            if(Capacitor.isNativePlatform()&&!cross.history&&!window.confirm('Keep up to 100 redacted notification events for 24 hours in encrypted storage on this phone? Only selected app identity, event times and status are saved. No title or message text is stored.'))return;
            policy({history:!cross.history});
          }),custom('View local metadata history',()=>{if(notificationBusy)return;notificationBusy=true;const current=owner;void notifications.notificationHistory().then(result=>{if(owner===current){history=result.items;owner?.vset('settings',{notificationChanged:Date.now()});}}).catch(()=>api.toast('Local notification history is unavailable.')).finally(()=>{notificationBusy=false;});}),custom('Clear local metadata history',()=>{if(window.confirm('Permanently clear local notification metadata history?'))void run(async()=>{await notifications.clearNotificationHistory();history=[];});}));
          if(history!==null){if(!history.length)crossRows.push(info('History','No retained events'));for(const row of history)crossRows.push(info(row.appLabel,`${row.state} · ${new Date(row.at).toLocaleString()} · no action available`));}
        }
        const interruption:Bag={all:'No DND suppression reported',priority:'Priority interruptions only',alarms:'Alarms only',none:'Interruptions suppressed',unknown:'Unavailable'};
        page.groups = [group([info('Alpha notifications', topValues.Notifications),info('Do Not Disturb',interruption[delivery.interruption]||'Unavailable'),info('Delivery timing','Android battery policies may delay alerts'),Capacitor.isNativePlatform()?nav('Manage Alpha notifications', 'notifications'):custom('Manage Alpha notifications',()=>void run(async()=>{await notifications.openAppSettings();}))]),
          ...((delivery.channels||[]).map((channel:Bag)=>group([info(channel.name,channel.blocked?'Channel blocked':channel.groupBlocked?'Channel group blocked':!delivery.appEnabled||!delivery.permissionGranted?'App notifications off':channel.importance<=2?'Silent channel':'Channel allowed'),{kNav:true,label:`Manage ${channel.name}`,lbl:`Manage ${channel.name}`,chev:true,noAB:true,go:()=>void notifications.openChannelSettings({id:channel.id}).catch(()=>api.toast('This notification channel is unavailable.'))}]))),group(crossRows)];
      } else if (page.title === 'Privacy & Enclave') {
        page.title='Privacy & runtime';
        page.hero={...page.hero,big:runtimeLocation,sub:'Hosted inference receives prompts and selected context. Local execution does not mean all data stays on the device.'};
        page.groups = [group([info('Agent execution', runtimeLocation),info('Model inference',connection.kind==='resident'&&connection.session?'Configured hosted provider':'Managed by the selected agent'), info('On-device speech', localSpeech)]), group(Object.entries(facts.permissions || {}).map(([label, granted]) => info(label, !Capacitor.isNativePlatform()&&facts.permissionStates?.[label]?({granted:'Granted in browser',prompt:'Ask when used',denied:'Blocked in browser',unknown:'Managed by browser'} as Bag)[facts.permissionStates[label]]:label==='Location'?(facts.locationAccess==='precise'?'Precise location allowed':facts.locationAccess==='approximate'?'Approximate location allowed':'Not allowed'):granted ? 'Allowed for Alpha' : 'Not allowed'))), group([nav('Manage Alpha permissions', 'privacy')])];
      } else if (page.title === 'Sound & vibration') {
        const volume = (label: string, stream: string) => {
          const value = controls.volumes?.find((v: Bag) => v.stream === stream);
          return info(label, value && value.max > 0 ? `${Math.round(value.current * 100 / value.max)}%` : 'Unavailable');
        };
        page.groups = [group([volume('Media', 'music'), volume('Ring', 'ring'), volume('Alarm', 'alarm')]), group([nav('Manage sound in Android', 'sound')])];
      } else if (page.title === 'Display') {
        page.hero={...page.hero,sub:Capacitor.isNativePlatform()?'Alpha app text · Android accessibility scale also applies':'Alpha app text size',subCss:'font-size:13px;color:var(--fg)'};
        for (const g of page.groups) g.rows = g.rows.map((row: Bag) => {
          if(row.label==='Brightness')return nav('Manage brightness in Android','display');
          if(row.label!=='Text size')return row;
          if(!Number.isInteger(facts.textScalePercent))return info('Text size','Native setting unavailable');
          const percent=facts.textScalePercent;
          return {...row,valueLabel:`${percent}%`,v:percent<=100?(percent-75)*2:percent-50,set:(event:Event)=>{
            const value=Number((event.target as HTMLInputElement).value),requested=Math.round(value<=50?75+value/2:value+50),token=++scaleGeneration,instance=owner;
            ++generation;void device.setTextScale({percent:requested}).then(result=>{if(owner===instance&&token===scaleGeneration){facts={...facts,...result};instance?.vset('settings',{nativeReadAt:Date.now()});}}).catch(()=>{if(owner===instance&&token===scaleGeneration)api.toast('Text size could not be saved.');});
          }};
        });
      }
    }
    if(!Capacitor.isNativePlatform()) {
      for(const page of out.stack){
        if(page.title==='About')page.groups=[group([info('Alpha Phone','0.1.0'),info('Runtime','Browser development'),info('Storage','This browser profile')])];
      }
      const browserLabels=(value:any):any=>{if(typeof value==='string')return value.replaceAll('Manage brightness in Android','Brightness').replaceAll('Manage sound in Android','Sound settings').replaceAll('Unavailable','Browser managed').replaceAll('Manage in Android','Browser device').replaceAll('in Android','in browser').replaceAll('Android settings','Browser device settings').replaceAll('Android Calendar','Browser calendar').replaceAll('Android device information','Browser device information').replaceAll('Android developer settings','Browser developer settings').replaceAll('Device accounts in Android','Browser accounts').replaceAll('On this phone','In this browser').replaceAll('on this phone','in this browser').replaceAll('Android access not granted','Development event access off').replaceAll('Waiting for Android listener','Waiting for local events').replaceAll('Selected apps connected','Selected development apps connected').replaceAll('Android battery policies may delay alerts','Alerts appear while Alpha is open').replaceAll('Native setting unavailable','Browser setting').replaceAll('Wi-Fi transport · network names stay in Android settings','Development network');if(Array.isArray(value))return value.map(browserLabels);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,browserLabels(v)]));return value;};
      return browserLabels(out);
    }
    return out;
  };
}
