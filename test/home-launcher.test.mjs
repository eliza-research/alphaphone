import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {renderToStaticMarkup} from 'react-dom/server';
const {installHomeLauncher,appKey}=await tsImport('../apps/app/src/prototype/home-launcher.ts',import.meta.url);
const icon='data:image/png;base64,iVBORw0KGgo=';
const apps=[
 {packageName:'com.android.settings',label:'Settings',icon},
 {packageName:'org.example.camera',label:'Caméra'},
 {packageName:'com.android.chrome',label:'Chrome'},
 {packageName:'com.example.reset',label:'Reset tools'},
];
// Shared controller/search/storage cases moved to the upstream native-system suite.

test('shell Home and All apps use the same favorite order; product taps never call native launch', async () => {
  let saved = null;
  const opened = [];
  const nativeCalls = [];
  class Shell {
    S() { return {drawer: true}; }
    setState() {}
    renderVals() { return {isOn: true, isView: false, ic: {grid: 'grid'}, apps: [{key: 'notes', label: 'Notes', d: 'note', open: () => { opened.push('notes'); }}, {key: 'settings', label: 'Settings', d: 'gear', open: () => { opened.push('settings'); }}]}; }
  }
  const launcher = installHomeLauncher(Shell, {list: async () => ({apps}), launch: async target => { nativeCalls.push(target); }},
    {favorites: {read: () => saved, write: keys => { saved = [...keys]; }}});
  const shell = new Shell();
  shell.renderVals();
  await launcher.load();
  let rendered = shell.renderVals();
  assert.deepEqual(rendered.apps.map(a => a.label), ['Notes', 'Settings']);
  const html=()=>renderToStaticMarkup(shell.renderVals().installedAppsLauncher);
  let markup=html();
  const shown=[...markup.matchAll(/data-launcher-(?:app|favorite)="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(shown.length, apps.length+2);
  assert.equal(new Set(shown).size,shown.length,'Favorites and inventory never duplicate an entry');
  const find=key=>launcher.snapshot().apps.find(app=>appKey(app)===key);
  await launcher.launch(find('alpha:notes'));
  assert.deepEqual(opened, ['notes']); assert.deepEqual(nativeCalls, []);
  assert.match(markup,/aria-label="Open Settings \(Alpha Phone\)"/);
  await launcher.launch(find('alpha:settings'));
  assert.deepEqual(opened, ['notes','settings']); assert.deepEqual(nativeCalls, []);
  assert.match(markup,/aria-label="Open Settings \(com.android.settings\)"/);
  await launcher.launch(find('com.android.settings'));
  assert.deepEqual(nativeCalls,[{packageName:'com.android.settings'}]);
  launcher.toggleFavorite(find(appKey(apps[0])));
  launcher.moveFavorite(find('alpha:notes'),1);
  rendered=shell.renderVals();
  assert.equal(rendered.apps[1].label,'Notes','Moving later changes row-major Home order');
  launcher.toggleFavorite(find('alpha:notes'));
  rendered=shell.renderVals();
  assert.equal(rendered.apps.some(app=>app.label==='Notes'),false);
  assert.match(html(),/data-launcher-app="alpha:notes"/);

});


test('default Alpha Home performs no installed-app scan until the drawer opens', async () => {
  const previous = globalThis.document;
  globalThis.document = Object.assign(new EventTarget(), {hidden: false});
  let reads = 0, saved = null;
  class Shell {
    S() { return {drawer: false}; }
    setState() {}
    renderVals() { return {isOn: true, isView: false, apps: [{key: 'notes', label: 'Notes', open() {}}]}; }
  }
  try {
    const launcher = installHomeLauncher(Shell, {list: async () => {reads++; return {apps};}, launch: async () => {}}, {favorites: {read: () => saved, write: keys => {saved = [...keys];}}});
    const shell = new Shell(); shell.renderVals(); shell.componentDidMount();
    await new Promise(setImmediate); assert.equal(reads, 0);
    shell.openAllApps(); await new Promise(setImmediate); assert.equal(reads, 1);
    assert.equal(launcher.snapshot().apps.length, apps.length + 1);
    shell.componentWillUnmount();
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
