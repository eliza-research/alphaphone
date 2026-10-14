import fs from 'node:fs';
import path from 'node:path';

/** A product-partition RRO is required because Alpha's APK is presigned/preprocessed. */
export function writeAospCapabilityOverlay(output, packageName) {
 if(!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(packageName))throw Error('Invalid capability target package');
 const files={
  'image-capabilities/Android.bp': 'runtime_resource_overlay {\n    name: "AlphaImageCapabilityOverlay",\n    product_specific: true,\n    sdk_version: "current",\n}\n',
  'image-capabilities/AndroidManifest.xml': `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}.imagecapabilities">\n    <overlay android:targetPackage="${packageName}" android:targetName="AlphaImageProvisioning" android:isStatic="true" android:priority="10" />\n    <application android:hasCode="false" />\n</manifest>\n`,
  'image-capabilities/res/values/capabilities.xml': '<?xml version="1.0" encoding="utf-8"?>\n<resources><bool name="alpha_aosp_image_capability">true</bool></resources>\n',
  'image-capabilities/README.md': '# Alpha image capability\n\nProduction staging only. This product-partition runtime resource overlay enables the image marker of the presigned APK. Native admission also requires a system-installed, non-debug, non-test-mocks application. Launcher flavor and HOME role are insufficient. Contacts requires separate provider permission; Telecom and SMS adapters remain unavailable. Positive image and provider acceptance remain separately required. This is staging evidence, not image boot or device acceptance.\n',
 };
 for(const [name,bytes] of Object.entries(files)){const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}
 fs.appendFileSync(path.join(output,'product.mk'),'\n# Production image capability for the presigned Alpha APK.\nPRODUCT_PACKAGES += AlphaImageCapabilityOverlay\n');
 return files;
}
