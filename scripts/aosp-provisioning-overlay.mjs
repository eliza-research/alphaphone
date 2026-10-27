/** Alpha requires its existing Autofill surface; shared image composition is upstream. */
import {provisioningComponents as sharedComponents} from '../vendor/eliza/packages/os/scripts/android/launcher-provisioning.mjs';
export {manifestComponents, renderProvisioningOverlay, writeProvisioningOverlay} from '../vendor/eliza/packages/os/scripts/android/launcher-provisioning.mjs';
export function provisioningComponents(xmltree, packageName) {
  const components = sharedComponents(xmltree, packageName);
  if (!components.autofill) throw new Error('The Alpha APK must declare exactly one BIND_AUTOFILL_SERVICE AutofillService');
  return components;
}
