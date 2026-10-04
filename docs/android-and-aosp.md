# Android and AOSP build contract

## Artifact identities

Package: `ai.elizaresearch.alphaphone`. Version source: `app.config.json`. AOSP module: `AlphaPhone`.
Standalone and launcher variants share data and signing identity within this product.
Use `adb install -r` to replace them. Do not uninstall a real user's app to switch variants.

`npm run android:build` builds signed debug and unsigned release artifacts for both
flavors, Android instrumentation APKs and Android lint. `android:verify` inspects
compiled package IDs, HOME/LAUNCHER filters, bundled web assets, debug flags and debug
signatures. These checks inspect APK bytes, not source strings alone.

## Signing

Development uses the Android debug keystore outside the repository. A release owner
must zipalign/sign the unsigned release APK with the controlled application key,
verify with `apksigner`, and supply an independently reviewed descriptor. Keep keys
in the signing service/CI secret store. No production signing material is created
by setup. Pin app certificate and versionCode across APK and OS releases.

```json
{
  "schemaVersion": 1,
  "brand": "alphaphone",
  "moduleName": "AlphaPhone",
  "packageName": "ai.elizaresearch.alphaphone",
  "apkSha256": "64 lowercase hex characters from the signed APK",
  "certificateSha256": "64 lowercase hex characters from the approved signer"
}
```

```sh
npm run aosp:stage -- --apk /absolute/signed-launcher.apk \
  --descriptor /absolute/reviewed-launcher.json --output /absolute/new-overlay
```

The upstream helper rejects a package/hash/signer mismatch, absent HOME filter,
existing output directory and debug APK without the explicit development flag.
Unsigned release APKs cannot pass signature verification. It inspects a private copy
of the same bytes it stages and writes a presigned/preprocessed nonprivileged Soong
`android_app_import` plus a `PRODUCT_PACKAGES` fragment. No local-agent marker or
privileged permission whitelist is fabricated for a thin launcher.

## Full AOSP product integration

1. Allocate a Linux x86_64 AOSP builder with the storage/RAM required by the selected
   pinned source tree. macOS SDK builds are sufficient for APKs, not this image lane.
2. Select exact hardware/SKU, Android branch, kernel/vendor inputs and compatible
   WebView/browser. Validate upstream source locks; do not infer support from a mockup.
3. Build/sign this product's launcher; admit it with the descriptor above. Copy the
   generated directory to `vendor/alphaphone` in a clean AOSP checkout.
4. In the selected product makefile add:
   `$(call inherit-product, vendor/alphaphone/product.mk)`.
   Use the existing `packages/os/android` source locks, environment and build tooling
   for the base image. Do not claim the custom launcher satisfies the existing full
   Eliza local-inference payload validator.
5. The add-on keeps other launchers intact. Choose this app as default HOME through
   explicit device provisioning. In disposable userdebug validation,
   `adb shell cmd package set-home-activity ai.elizaresearch.alphaphone/.MainActivity` demonstrates
   selection; production must use the enrolled-device/default-role policy.
6. Build the actual product with `source build/envsetup.sh`, its pinned `lunch` target
   and `m`. No generic lunch command can substitute for an approved hardware target.
7. Boot the exact image in Cuttlefish, verify package path under `/product`, signer,
   HOME resolution after reboot, screen/IME/native bridge behavior and absence of crashes.
8. Validate the same signed release on physical hardware: radios, audio/mic, touch,
   camera, suspend/resume, charging, keys, auth/agent reconnect, accessibility and
   recovery. Then validate signed OTA and rollback. Record image/APK/source hashes.

An SDK emulator with an installed launcher is useful HOME/app evidence, but is not
proof that this product makefile built or booted in a custom AOSP image.

## Distribution boundaries

HOME is not device owner, accessibility service, overlay permission, SMS/dialer or
assistant role. Do not add a broad `privapp-permissions` list to make a test pass.
A persistent cross-app helper and secure Chromium component require their explicit
native/OS integration and signer-admission work in the implementation plan. Managed
kiosk is not enabled by default; preserve a recovery route and normal Android settings.

## Required Clock provider

The Alpha overlay explicitly includes AOSP `DeskClock` alongside its launcher. Keep this module in the selected product even when generic upstream de-bloating changes. A missing Clock handler is not successful MVP alarm acceptance. Both standalone and launcher APKs use the installed provider and expose honest unavailable results; neither bundles Clock inside its APK or owns exact-alarm delivery.

After booting the exact signed image, perform read-only handler admission for the intended Android user:

```sh
ANDROID_SERIAL=<exact-serial> ALPHA_ANDROID_USER=<user-id> node scripts/verify-aosp-clock.mjs
```

The check requires enabled `com.android.deskclock` and its set/show/snooze/dismiss activity handlers. It does not launch an alarm, change permissions, provision a device, or prove ringing. Alpha's shared manifest declares the caller SET_ALARM permission and visibility queries; Clock's own notifications/exact-alarm access remains separately verified on the image. Confirm actual set/fire/snooze/dismiss, permission denial, reboot, time-zone/DST, cancellation and DND/physical audio before claiming alarm MVP completion.

DeskClock is the real AOSP module defined in `packages/apps/DeskClock/Android.bp` and included by the standard handheld product. Pin its source through the selected image manifest; do not substitute an unreviewed downloaded APK.

## Dedicated development kiosk (October 3)

The explicit `--development-kiosk` staging option supersedes the ordinary-app
policy above **only for the selected development image**. It adds a framework
resource overlay that removes Android's navigation bar. Alpha's device-owner
policy uses lock-task mode with external activity launches blocked, no system
information/shade/Home/Recents features, and persistent Alpha HOME selection.
Android Settings and the recovery launcher remain installed for ADB maintenance;
they are not reachable through the locked user interface. Cross-package flows,
including system document pickers and external provider setup, are also blocked
until implemented inside Alpha or explicitly added to a future managed policy. Kernel/bootloader and
ADB access intentionally remain recovery routes, so this is not an anti-tamper
security boundary against the developer controlling the machine.

After installing the matching launcher APK on the dedicated Cuttlefish userdebug
image, run `ANDROID_SERIAL=127.0.0.1:6520 node scripts/provision-cuttlefish-kiosk.mjs`.
This refuses physical/non-userdebug devices and an existing different device owner.
It enrolls Alpha, enables developer options/ADB, grants the status reader's phone
and Bluetooth permissions, keeps the plugged-in device awake, suppresses the fullscreen introduction,
and selects HOME. Enrollment is separate from ordinary
standalone/launcher APK installation. Ownership/policies survive guest reboot and
same-signer APK updates; factory-reset images must be enrolled again.

Status indicators come from Android battery/network/radio readings, not the mock
status template. Alpha Settings provides brightness, media/ring/alarm volume,
Wi-Fi/Bluetooth switches, saved Wi-Fi network selection when permission is available,
time zone, and device/development information. Display's Light/Dark choice persists
and themes the launcher status and control panel. New credentialed Wi-Fi profiles,
Bluetooth pairing, SIM/APN and specialized permission administration still require
ADB provisioning in this development build; unavailable values are not simulated.
The virtual radio readings do not establish physical radio/hardware acceptance.

ADB retains the existing Cuttlefish transport configuration. This virtual image
does not establish physical USB authorization behavior. Docker publishes its ADB
and viewer ports only on `127.0.0.1`; no LAN-wide listener or bootloader-unlock
operation is configured. The host service runs
`scripts/cuttlefish/start-development.sh` with ANDROID_HOME, ALPHA_REPOSITORY and ALPHA_NODE (absolute Node executable);
it starts the existing container/guest and reconnects ADB after adbd/guest restarts.
Developer settings are restored automatically. AOSP `userdebug` and the explicit
image USB `adb` property retain development access.

Recovery without Android Settings (replace the serial for your approved device):

```sh
adb -s 127.0.0.1:6520 shell settings put global alpha_launcher_lock 0
# Reboot applies the recovery switch even when the device owner cannot be force-stopped.
adb -s 127.0.0.1:6520 reboot
# Wait for Android to finish booting before installing.
# Install the same signing identity; package data is retained.
adb -s 127.0.0.1:6520 install -r artifacts/launcher-debug.apk
# Re-enroll/reapply after maintenance (idempotent).
ANDROID_SERIAL=127.0.0.1:6520 node scripts/provision-cuttlefish-kiosk.mjs
adb -s 127.0.0.1:6520 reboot
# For bootloader/fastboot maintenance, when deliberately requested:
# adb -s 127.0.0.1:6520 reboot bootloader
```

Do not run bootloader flashing/unlocking as a smoke test. Cuttlefish boot evidence
is not proof of a physical phone's USB authorization, bootloader policy, OTA or rollback.

For the AOSP presigned importer, the Android debug APK's JNI entries must be
uncompressed and page-aligned. Prepare it without changing any payload entry:

```sh
ANDROID_HOME=/path/to/sdk python3 scripts/prepare-aosp-debug-apk.py \
  --keystore /path/to/existing/debug.keystore
npm run aosp:stage -- --apk artifacts/launcher-aosp-debug.apk \
  --development --development-kiosk --output artifacts/aosp/alpha-kiosk
```

The preparation script requires a debuggable input, compares every non-signature
entry and both signer certificates, checks 16 KiB ZIP alignment, and writes
`artifacts/aosp-apk-preparation.json`. It never creates a production signing key.
