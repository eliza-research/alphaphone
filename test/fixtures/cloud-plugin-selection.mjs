import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preparedSdkForTests} from './prepared-sdk.mjs';
const {config} = JSON.parse(readFileSync(0, 'utf8'));
// The normal prepared runtime owns installed SDK dependencies. Authenticate it
// at this app's exact pin rather than treating generated metadata as a raw vendor checkout.
const {source}=preparedSdkForTests();
const {collectPluginNames} = await import(pathToFileURL(join(source,'packages/agent/src/runtime/plugin-collector.ts')).href);
console.log('SDK_PLUGIN_SELECTION=' + JSON.stringify([...collectPluginNames(config)].sort()));
