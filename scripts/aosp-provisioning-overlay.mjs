/** P-78 defers the assistant role; Alpha still requires HOME and Autofill. Shared image composition is upstream. */
import {provisioningComponents as sharedComponents} from '../vendor/eliza/packages/os/scripts/android/launcher-provisioning.mjs';
export {manifestComponents, renderProvisioningOverlay, writeProvisioningOverlay} from '../vendor/eliza/packages/os/scripts/android/launcher-provisioning.mjs';
export function provisioningComponents(xmltree, packageName) {
  const components = sharedComponents(xmltree, packageName, {assistantRequired:false});
  if (!components.autofill) throw new Error('The Alpha APK must declare exactly one BIND_AUTOFILL_SERVICE AutofillService');
  return components;
}
