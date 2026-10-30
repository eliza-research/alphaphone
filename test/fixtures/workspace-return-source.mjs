import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {root,nativeSource} from './jvm-tools.mjs';

// Tests may qualify a new upstream checkout before its reviewed commit is pinned.
// Production staging still admits only upstream.lock.json and vendor/eliza.
const upstream = process.env.ALPHA_NATIVE_RETURN_SOURCE_DIR ?? join(root,'vendor/eliza');
assert.ok(isAbsolute(upstream),'Native return test source must be an absolute checkout path');
export const returnSource = name => join(upstream,'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection',name);
export const returnFixture = name => join(upstream,'plugins/plugin-native-agent/test/connection',name);
export const returnAdmission = join(upstream,'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java');
export const returnSources = () => [returnSource('WorkspaceAppReturn.java'),returnSource('WorkspaceAppReturnFlow.java'),returnAdmission];
export const workspaceConstant = name => {
 const source=readFileSync(nativeSource('AlphaConnectionPlugin.java'),'utf8');
 const match=source.match(new RegExp(`static final String ${name}="([^"]+)";`));
 assert.ok(match,`Missing product return constant ${name}`);
 return match[1];
};
