import { test, expect, type Page } from '@playwright/test';
// Runs only in the `production` project: a flag-off `vite build` served by `vite preview`.
// It proves the shipped web bundle exposes no mock, fixture or developer surface.
// It does not prove Android packaging, which is audited separately per APK.

const fixtureNames = ['Maya Chen', 'Jordan Park', 'Priya Nair', 'Alex Kim', 'Ritual Coffee', 'Design review at', 'Unlock for details', 'you@gmail.example'];
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

async function trackCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', message => { if (/Content Security Policy|Refused to (load|execute|connect|create|apply|frame)/i.test(message.text())) violations.push(message.text()); });
  await page.addInitScript(() => {
    (window as any).cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => (window as any).cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return async () => [...violations, ...await page.evaluate(() => (window as any).cspViolations as string[])];
}

test('the bundle records production flags and ships a CSP', async ({ page, request }) => {
  expect(await (await request.get('/build-flags.json')).json()).toEqual({ testMocks: false });
  await page.goto('/?tools=1');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  for (const directive of ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "object-src 'none'", "base-uri 'none'"]) expect(policy).toContain(directive);
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});

for (const entry of ['/?mode=mock', '/?fixture=1&start=inbox', '/?mode=dev&start=wallet', '/?mode=dev&workflows=agent&start=workflows&theme=dark']) {
  test(`entry point ${entry} renders the live product`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(offline);
    await page.goto(entry);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
    await expect(page.locator('.alpha-dev-tools')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Device controls', exact: true })).toHaveCount(0);
    await expect(page.getByText(/mock mode/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('a stored mock selection on Android opens the chooser and never enters mock mode', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any; w.androidBridge = {};
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'mock' })); }
    const calls: string[] = w.nativeCalls = [];
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AlphaConnection', methods: methods(['pauseNotificationCollection', 'secureRead', 'secureWrite', 'secureRemove', 'request', 'cancel', 'addListener', 'removeListener']) },
        { name: 'AlphaHostedResults', methods: methods(['disableBackground', 'status', 'pendingResult', 'addListener', 'removeListener']) },
        { name: 'AlphaNotifications', methods: methods(['resumeCrossApp', 'status', 'crossAppStatus', 'addListener', 'removeListener']) },
        { name: 'Agent', methods: methods(['getStatus']) }, { name: 'DeviceApps', methods: methods(['buildInfo']) },
      ],
      nativePromise: async (plugin: string, method: string) => {
        calls.push(`${plugin}.${method}`);
        if (plugin === 'Agent') return { packaged: false, state: 'unavailable' };
        if (method === 'secureRead') return { value: null };
        if (plugin === 'DeviceApps') return { launcher: false, version: 'production-surface' };
        return {};
      },
    };
  });
  await page.goto('/?tools=1');
  const chooser = page.locator('.alpha-connection');
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
  await expect(page.locator('.mock-mode-banner')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({ kind: 'none' });
  const calls: string[] = await page.evaluate(() => (window as any).nativeCalls);
  // Neither the mock barrier nor any collector resume runs without an explicit choice.
  for (const call of ['AlphaConnection.pauseNotificationCollection', 'AlphaNotifications.resumeCrossApp']) expect(calls).not.toContain(call);
  await expect(chooser.getByText(/mock mode/i)).toHaveCount(0);
  await expect(chooser.getByText('Local development agent', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(chooser).toBeVisible();
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
});

test('the chooser and Settings offer only production connections', async ({ page }) => {
  await page.goto('/?tools=1');
  const chooser = page.locator('.alpha-connection');
  // The browser build explains its real options on first run.
  await expect(chooser.getByText('Your agent runs locally in the Android app. Remote agents and pairing are unavailable.', { exact: true })).toBeVisible();
  for (const summary of await chooser.locator('summary').all()) await summary.click();
  const text = await chooser.innerText();
  expect(text).not.toMatch(/mock mode/i);
  expect(text).not.toContain('Local development agent');
  expect(text).not.toMatch(/staging/i);
  expect(text).not.toContain('Development connections');
  await expect(chooser.getByLabel('Environment')).toHaveCount(0);
  await expect(chooser.getByRole('button', { name: 'Start local agent', exact: true })).toHaveCount(0);
  for (const name of ['Connect remote agent', 'Manage Cloud account']) await expect(chooser.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(chooser.getByRole('button',{name:'Use local apps without AI',exact:true})).toBeVisible();
  // Eliza Cloud refuses credentialed requests from this web origin, so no sign-in that always fails is offered.
  await expect(chooser.getByRole('button', { name: 'Sign in with Eliza Cloud', exact: true })).toHaveCount(0);

  await chooser.getByRole('button', { name: 'Use local apps without AI', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('[data-screen]');
  await expect(settings.getByText('Agent connection', { exact: true })).toBeVisible();
  const settingsText = await settings.innerText();
  expect(settingsText).not.toMatch(/mock mode/i);
  expect(settingsText).not.toMatch(/staging/i);
  await page.getByText('About', { exact: true }).click();
  // The About header and the Runtime row both name the web runtime.
  await expect(settings.getByText('Web app', { exact: true }).first()).toBeVisible();
  await expect(settings.getByText('Development preview', { exact: true })).toHaveCount(0);
  await expect(settings.getByText(/^\d+\.\d+\.\d+/).first()).toBeVisible();
  await settings.getByText('Open source licenses', { exact: true }).click();
  await expect(settings.getByText('Open source licenses', { exact: true }).first()).toBeVisible();
  // Either the generated notices or the honest fallback, never an empty page.
  await expect(settings.getByText(/License notices unavailable|MIT|Apache|BSD|ISC|MPL/).first()).toBeVisible();
});

test('Settings shows the flags and obligations of flagged license entries, and nothing extra on unflagged ones', async ({ page }) => {
  const notices = [
    { name: 'plain-package', version: '1.0.0', license: 'MIT', source: 'https://example.test/plain', text: 'MIT terms', flags: [] },
    { name: 'copyleft-package', version: '2.0.0', license: 'AGPL-3.0-or-later', source: 'https://example.test/copyleft', text: 'AGPL terms',
      flags: ['copyleft-strong', 'network-copyleft', 'future-flag'],
      obligations: [{ flag: 'copyleft-strong', note: 'Corresponding source must be available at https://example.test/copyleft.' }, { flag: 'network-copyleft', note: 'The source offer extends to network use.' }] },
    { name: 'legacy-entry', version: '3.0.0', license: 'ISC', source: 'https://example.test/legacy', text: 'ISC terms' },
  ];
  await page.route('**/licenses/third-party-notices.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(notices) }));
  await page.goto('/?tools=1');
  await page.locator('.alpha-connection').getByRole('button', { name: 'Use local apps without AI', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('[data-screen]');
  await page.getByText('About', { exact: true }).click();
  await settings.getByText('Open source licenses', { exact: true }).click();
  await expect(settings.getByText('copyleft-package', { exact: true })).toBeVisible();
  // Known flags are labelled; a flag this build does not know is shown as written, never dropped.
  await expect(settings.getByText('Copyleft (GPL family) · Network copyleft (AGPL) · future-flag', { exact: true })).toBeVisible();
  await expect(settings.getByText('Corresponding source must be available at https://example.test/copyleft.', { exact: true })).toBeVisible();
  await expect(settings.getByText('The source offer extends to network use.', { exact: true })).toBeVisible();
  // One flagged entry only: unflagged and pre-flag entries get no flag row.
  await expect(settings.getByText('Flagged', { exact: true })).toHaveCount(1);
  await expect(settings.getByText('Obligation', { exact: true })).toHaveCount(2);
  await expect(settings.getByText('plain-package', { exact: true })).toBeVisible();
  await expect(settings.getByText('legacy-entry', { exact: true })).toBeVisible();
});

test('Settings keeps the unavailable fallback when the license notices cannot be read', async ({ page }) => {
  await page.route('**/licenses/third-party-notices.json', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?tools=1');
  await page.locator('.alpha-connection').getByRole('button', { name: 'Use local apps without AI', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.locator('[data-screen]');
  await page.getByText('About', { exact: true }).click();
  await settings.getByText('Open source licenses', { exact: true }).click();
  await expect(settings.getByText('License notices unavailable', { exact: true })).toBeVisible();
  await expect(settings.getByText('Flagged', { exact: true })).toHaveCount(0);
});

test('deferred apps are absent and root views show honest unconnected states', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/?tools=1');
  for (const deferred of ['Phone', 'Messages', 'Contacts', 'Wallet']) await expect(page.getByRole('button', { name: deferred, exact: true })).toHaveCount(0);
  const states: Record<string, RegExp> = {
    Inbox: /Connect Eliza Cloud/, Workflows: /Connect an agent for its automations\. Reminders on this phone stay available\./, Notes: /No notes yet/,
    Photos: /No photos/, Maps: /Map tiles are not connected/, Calendar: /\d/, Files: /Choose a document/, Settings: /Agent connection/,
  };
  for (const [view, expected] of Object.entries(states)) {
    await page.goto('/?tools=1');
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', view.toLowerCase());
    await expect(page.locator('[data-screen]')).toContainText(expected);
    const text = await page.locator('body').innerText();
    for (const name of fixtureNames) expect(text, `${view} shows fixture ${name}`).not.toContain(name);
  }
});

test('sending chat without a connection opens the chooser', async ({ page }) => {
  await page.goto('/?tools=1');
  const chooser = page.locator('.alpha-connection');
  await expect(chooser).toBeVisible();
  await chooser.getByRole('button', { name: 'Close connection settings', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  const input = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
  await input.fill('What is on my calendar today?');
  await input.press('Enter');
  await expect(chooser).toBeVisible();
  await expect(page.getByText(/Development reply|emulator development agent/)).toHaveCount(0);
});

test('the CSP admits Home, Notes, Maps, Scan and PDF without violations', async ({ page }) => {
  test.setTimeout(120_000);
  const violations = await trackCsp(page);
  await page.addInitScript(offline);
  await page.goto('/?tools=1');
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('CSP note');
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open CSP note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await page.getByRole('button', { name: 'Maps', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600;
    const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 600);
    context.fillStyle = 'black'; context.font = '60px Arial'; context.fillText('Alpha searchable document', 50, 120);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await (await chooser).setFiles({ name: 'page.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByRole('img', { name: 'Document page 1', exact: true })).toBeVisible();
  const imagePdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download document PDF', exact: true }).click();
  expect((await imagePdf).suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole('button', { name: 'Close scan', exact: true }).or(page.getByRole('button', { name: /^Close/ }).last()).click();
  await page.getByRole('button', { name: 'Scan document', exact: true }).click();
  const second = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await (await second).setFiles({ name: 'page.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.getByRole('button', { name: 'Download searchable PDF', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review searchable PDF' });
  // Local OCR runs in a worker with WebAssembly: the policy must admit both.
  await expect(review.getByLabel('Page 1 line 1', { exact: true })).toHaveValue(/Alpha searchable/, { timeout: 90_000 });
  const searchable = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download reviewed searchable PDF', exact: true }).click();
  expect((await searchable).suggestedFilename()).toMatch(/\.pdf$/);
  expect(await violations()).toEqual([]);
});

test('production ignores the development render-failure hook', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/?tools=1');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
  await settings.click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agent connection', exact: true })).toBeVisible();
});

test('production signed-out voice requires Cloud without capture, upload or local fallback under the shipped CSP', async ({ page }) => {
  const violations = await trackCsp(page);
  const foreign: string[] = [], uploads: string[] = [], engines: string[] = [];
  // Stop a regression before it can contact a provider or upload anything.
  await page.route('**/*', async route => {
    const request=route.request(),url=new URL(request.url());
    if (!['127.0.0.1','localhost'].includes(url.hostname) && !['data:','blob:'].includes(url.protocol)) { foreign.push(request.url()); await route.abort(); return; }
    if (['POST','PUT','PATCH'].includes(request.method())) { uploads.push(request.url()); await route.abort(); return; }
    if (url.pathname.startsWith('/browser-speech/') || /\.(onnx|wasm)$/.test(url.pathname)) engines.push(url.pathname);
    await route.continue();
  });
  await page.addInitScript(offline);
  await page.addInitScript(() => {
    const counts=(window as any).voiceGate={microphone:0,recorders:0,audio:0,workers:0,playback:0};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{counts.microphone++;throw Error('Unsigned voice must not capture');}}});
    for(const [name,key] of [['MediaRecorder','recorders'],['OfflineAudioContext','audio'],['Worker','workers']] as const){
      const Original=(window as any)[name];
      if(Original)Object.defineProperty(window,name,{configurable:true,value:new Proxy(Original,{construct(){counts[key]++;throw Error('Unsigned voice must not start a local engine');}})});
    }
    // Clock primes an alert context on user gestures independently of voice.
    // Keep that inert while counting any capture, decode or synthesis processing.
    const processing=()=>{counts.audio++;throw Error('Unsigned voice must not process audio');};
    Object.defineProperty(window,'AudioContext',{configurable:true,value:class {
      state='suspended';resume=async()=>{};close=async()=>{};
      createMediaStreamSource=processing;createMediaStreamDestination=processing;
      createBufferSource=processing;decodeAudioData=processing;createOscillator=processing;
    }});
    if(window.speechSynthesis)window.speechSynthesis.speak=()=>{counts.playback++;throw Error('Unsigned voice must not synthesize speech');};
    HTMLMediaElement.prototype.play=async function(){counts.playback++;throw Error('Unsigned voice must not play audio');};
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Record and transcribe', exact: true }).click();
  await expect(page.getByText('Sign in to Eliza Cloud to use voice.',{exact:true})).toBeVisible();
  const connect=page.getByRole('button',{name:'Connect Eliza Cloud',exact:true});await expect(connect).toBeEnabled();
  for(const name of ['Start recording','Record without transcription','Use development voice','Use browser voice','Use on-device voice','Transcribe on this device','Type transcript instead'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  await connect.click();
  const account=page.getByRole('dialog',{name:'Eliza Cloud',exact:true});await expect(account).toBeVisible();
  await expect(account.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toHaveCount(0);
  await expect(account.getByText(/Eliza Cloud sign-in is available in the Alpha Phone Android app/)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).voiceGate)).toEqual({microphone:0,recorders:0,audio:0,workers:0,playback:0});
  expect(uploads).toEqual([]);expect(engines).toEqual([]);expect(foreign).toEqual([]);
  expect(await violations()).toEqual([]);
});
for (const mode of ['signed-out','empty','unavailable','funded','replaced','unpackaged','legacy-offline'] as const) {
 test(`resident billing onboarding: ${mode}`,async({page})=>{
  await page.addInitScript(mode=>{
   const w=window as any;w.androidBridge={};w.residentCalls=[];
   const id='9f1dc45a-4011-4e44-947a-30d999d24fa5';
   const values:Record<string,string>={};let credentialReads=0;
   if(mode==='legacy-offline')localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
   if(mode!=='signed-out'&&mode!=='unpackaged'&&mode!=='legacy-offline')values['cloud:production']=JSON.stringify({token:'synthetic-cloud-key',credentialId:id,expiresAt:Date.now()+60000});
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[
    {name:'DeviceApps',methods:methods(['buildInfo'])},
    {name:'Agent',methods:methods(['getStatus','start','stop','configureCloudProvider','request'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureRemove','secureCompareExchange','request','cancel','openExternal'])},
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
   ],nativePromise:async(plugin:string,method:string,input:any)=>{
    w.residentCalls.push({plugin,method,path:input?.path,url:input?.url});
    if(plugin==='DeviceApps')return{launcher:false,version:'billing-fixture'};
    if(plugin==='AlphaNotifications')return{permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud')return{microphone:'granted'};
    if(plugin==='Agent'){
     if(method==='getStatus')return{packaged:mode!=='unpackaged',state:'stopped',serviceActive:false,socketListening:false};
     if(method==='request'){
      const body=input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:
       input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:
       input.path==='/api/conversations'?{conversations:[]}:{};
      return {status:200,body:JSON.stringify(body)};
     }
     return {};
    }
    if(method==='secureRead'){if(input.slot==='cloud:production'&&++credentialReads===5&&mode==='replaced')values[input.slot]=JSON.stringify({token:'synthetic-replacement-key',credentialId:'f04d4d24-6978-42a2-a968-995d76debf77',expiresAt:Date.now()+60000});return{value:values[input.slot]??null};}
    if(method==='secureWrite'){values[input.slot]=input.value;return{};}
    if(method==='secureRemove'){delete values[input.slot];return{};}
    if(method==='request'){
     const path=new URL(input.url).pathname;
     if(path==='/api/v1/user')return{status:200,data:{success:true,data:{id}}};
     if(path==='/api/v1/subscription/entitlement')return { status: 404, data: {} }; // Deployed Cloud has no subscription entitlement route yet.
     if(path==='/api/v1/credits/balance')return mode==='unavailable'?{status:503,data:{error:'temporary'}}:{status:200,data:{balance:mode==='funded'||mode==='replaced'?5:0}};
     throw Error('Unexpected Cloud route: '+path);
    }
    return {};
   }};
  },mode);
  await page.goto('/');
  if(mode==='signed-out')await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeVisible();
  if(mode==='empty')await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
  // A billing outage is not a gate: Cloud decides each AI request, and local apps keep working.
  if(mode==='unavailable'){
   await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:/Manage plan in Eliza Cloud|Open Eliza Cloud billing/})).toHaveCount(0);
  }
  const admitted=mode==='funded'||mode==='unavailable'||mode==='empty';
  if(mode==='funded')await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
  if(mode==='replaced')await expect(page.getByRole('alert')).toContainText(/account changed/i);
  if(mode==='unpackaged'||mode==='legacy-offline'){await expect(page.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Welcome to Alpha'})).toBeVisible();}
  // Every unconnected state offers the honest offline path; a connected agent closes Welcome.
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(admitted?0:1);
  if(!admitted){
   await page.getByRole('button',{name:'Use local apps without AI',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'Welcome to Alpha'})).toHaveCount(0);
   for(const view of ['Notes','Calendar']){
    await page.getByRole('button',{name:view,exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view',view.toLowerCase());
    await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
    await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
   }
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({kind:'offline',localApps:true});
  }
  const calls=await page.evaluate(()=>(window as any).residentCalls);
  expect(calls.some((c:any)=>c.url?.includes('/personal/')||c.url?.includes('/upgrade-tier'))).toBe(false);
  const native=calls.filter((c:any)=>c.plugin==='Agent').map((c:any)=>c.method);
  if(admitted)expect(native.indexOf('stop')).toBeLessThan(native.indexOf('configureCloudProvider'));
  else expect(native).not.toContain('start');
  // Choosing local apps stops a packaged runtime and never configures inference.
  if(!admitted){expect(native).not.toContain('configureCloudProvider');if(mode!=='unpackaged')expect(native).toContain('stop');}
 });
}
test('resident local apps without AI persist across restart and can be closed and reopened',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.androidBridge={};w.residentCalls=[];
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[
   {name:'DeviceApps',methods:methods(['buildInfo'])},
   {name:'Agent',methods:methods(['getStatus','start','stop','request'])},
   {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureRemove','secureCompareExchange','request','cancel','openExternal'])},
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
  ],nativePromise:async(plugin:string,method:string,input:any)=>{
   w.residentCalls.push({plugin,method,url:input?.url});
   if(plugin==='AlphaVoiceCloud')return{microphone:'granted'};
   if(plugin==='DeviceApps')return{launcher:false,version:'local-apps-fixture'};
   if(plugin==='AlphaNotifications')return{permissionGranted:true,appEnabled:true};
   if(plugin==='Agent'&&method==='getStatus')return{packaged:true,state:'stopped',serviceActive:false,socketListening:false};
   if(method==='secureRead')return{value:null};
   // Network is off: every Cloud request fails.
   if(plugin==='AlphaConnection'&&method==='request')throw Error('Connection request failed');
   return {};
  }};
 });
 await page.goto('/');
 const welcome=page.getByRole('dialog',{name:'Welcome to Alpha'});
 await expect(welcome).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(welcome).toBeVisible();
 await welcome.getByRole('button',{name:'Use local apps without AI',exact:true}).click();
 await expect(welcome).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
 await expect(welcome).toHaveCount(0);
 const calls=await page.evaluate(()=>(window as any).residentCalls);
 expect(calls.filter((c:any)=>c.plugin==='Agent').map((c:any)=>c.method)).not.toContain('start');
 expect(calls.filter((c:any)=>c.method==='request')).toEqual([]);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:/Agent connection/}).click();
 await expect(welcome).toBeVisible();
 await expect(welcome.getByRole('button',{name:'Sign in with Eliza Cloud',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(welcome).toHaveCount(0);
});
test('resident local apps keep a saved Cloud sign-in available without contacting Cloud',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.androidBridge={};w.residentCalls=[];
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline',localApps:true}));
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[
   {name:'DeviceApps',methods:methods(['buildInfo'])},
   {name:'Agent',methods:methods(['getStatus','start','stop','request'])},
   {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureRemove','secureCompareExchange','request','cancel','openExternal'])},
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
  ],nativePromise:async(plugin:string,method:string,input:any)=>{
   w.residentCalls.push({plugin,method,slot:input?.slot,url:input?.url});
   if(plugin==='AlphaVoiceCloud')return{microphone:'granted'};
   if(plugin==='DeviceApps')return{launcher:false,version:'local-apps-fixture'};
   if(plugin==='AlphaNotifications')return{permissionGranted:true,appEnabled:true};
   if(plugin==='Agent'&&method==='getStatus')return{packaged:true,state:'stopped',serviceActive:false,socketListening:false};
   if(method==='secureRead')return{value:input?.slot==='cloud:production'?JSON.stringify({token:'synthetic-cloud-token',credentialId:'synthetic-credential'}):null};
   if(plugin==='AlphaConnection'&&method==='request')throw Error('Connection request failed');
   return {};
  }};
 });
 await page.goto('/');
 const welcome=page.getByRole('dialog',{name:'Reconnect Eliza Cloud'});
 await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
 await expect(welcome).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:/Agent connection/}).click();
 await expect(welcome.getByRole('button',{name:'Retry saved connection',exact:true})).toBeVisible();
 await expect(welcome.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
 const calls=await page.evaluate(()=>(window as any).residentCalls);
 expect(calls.filter((c:any)=>c.method==='request')).toEqual([]);
 expect(calls.filter((c:any)=>c.plugin==='Agent').map((c:any)=>c.method)).not.toContain('start');
});
