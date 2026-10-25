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

## Pixel 11 Pro preparation

Pixel 11 Pro (`grizzly`) has a separate preparation path. See the
[October 3 research, script audit and recovery runbook](pixel11-readiness-2026-10-03.md).
Run `npm run aosp:preflight` for a read-only blocker report; it does not authorize
flashing. The upstream hardware inventory still refuses this target.

For development Pixel 11 Pro product staging, add `--target grizzly --development`
to `aosp:stage`. The output includes Alpha product registration, but is not a built
or qualified image; follow the dated Pixel readiness report before any device work.

Alpha-specific read-only post-boot inspection is available as `npm run
aosp:postboot`. It requires an exact completed-image expectation, explicit USB
serial, pinned ADB executable and fresh report path. See the [Pixel 11 readiness
report](pixel11-readiness-2026-10-03.md) for its schema and limits; passing image
checks does not establish resident-agent execution, hardware or stock restoration.

## Pixel 10a preparation

Pixel 10a (`stallion`) uses the same Eliza AOSP platform as Alpha's Cuttlefish
image. GrapheneOS provides pinned extraction tooling and a bootloader/release
reference, not the platform base. Keep the `vendor/eliza` submodule pinned;
the Pixel 10a source-preparation work lives in a separate upstream worktree.

Stage the prepared, signed ARM64 launcher with its explicit source lock:

```sh
npm run aosp:stage -- --target stallion --development \
  --source-lock /path/to/eliza/packages/os/android/pixel10a.lock.json \
  --apk /path/to/launcher-aligned-signed.apk --output /path/to/new-alpha-vendor
```

Install that new overlay as `vendor/alphaphone` in the prepared AOSP checkout.
After successful, reference-checked extraction of stock `CP3A.261005.005`, apply
the patches in `android/aosp/stallion/patches` from the AOSP checkout. They
preserve the stock build ID as a warning and select Alpha's device
configuration. That configuration uses AOSP CarrierConfig and excludes the
Graphene-specific framework overlay; stock kernel, board configuration,
generated overlays, and vendor policy remain inherited from the pinned inputs.
SELinux neverallow checks stay enabled; resolve incompatible policy instead
of accepting the extraction tool's default bypass. The policy patch removes
duplicate AOSP type declarations while retaining the stock tmpfs attribute.
Alpha retains the Citadel erase policy but excludes the optional Graphene
Wi-Fi fault injector, whose shell property access violates AOSP neverallow rules.
Keep Alpha's vendor policy directory before the generated stock vendor policy:
Citadel declares `dump_gsc`, which the generated policy subsequently assigns
attributes to. Reversing those directories causes an unknown-type compiler error.
The vendor SELinux API `202604` matches the `cp2a` release configuration.
The attributed `aoad-id.patch` adds the missing Android Open Accessory daemon
ID (`1103`) from upstream commit `322ff5129d865a5e8d958667e6c63ac943449493`.
The extracted USB gadget init service requires this group; keep init validation
enabled rather than dropping the group or bypassing the verifier.

Apply `include-extracted-policy.patch` as well. AOSP's default SELinux build
collects the generated type declarations but does not consume adevtool's
`sepolicy_ext.cil` files. The patch wires those stock policy extensions into
the appropriate platform-extension, vendor, and recovery policy modules.
Without them, the Pixel module loader and Citadel services lack their init
domain transitions: the image can build and recovery can boot while normal
boot stalls waiting for graphics and hardware-backed storage. Keep neverallow
checks enabled when compiling the complete policy; adding individual service
transitions alone does not restore the omitted device permissions.

Apply `stats-abi.patch` to the generated vendor product. The factory
`libpixelstats.so` requires the factory `android.frameworks.stats-V3-ndk.so`,
including callback interface-version symbols absent from this AOSP baseline.
Copy that library from the verified factory vendor extraction into
`vendor/google_devices/stallion/proprietary/vendor/lib64/` before building;
its SHA-256 must be
`36259c0f38e9de97e313e4c32c705265d82239cc8002ba2def8c51210d9821b7`.
Conversely, Trusty's `android.frameworks.stats-V1-cpp.so` must be built from
this AOSP tree to match its libbinder ABI. The patch selects that vendor
module instead of the factory C++ library. Without these selections both
metrics services repeatedly fail dynamic linking after Android boots.

`AlphaPixelConfig` supplies the extracted eSIM flags to the system eSIM apps.
The factory eSIM firmware helper registers a Gservices observer at boot and
crashes if that authority is absent. This small, direct-boot-aware provider
implements only read-only key/prefix queries against the extracted flags file;
it has no network permission, accounts, or mutable settings. Its caller check
requires the exact installed system eSIM package UID (or the system/provider
UID). It must be installed as a system app with `forceQueryable` so the stock
clients can discover it without changing their manifests. The cursor protocol
is documented by the pinned [Gservices provider reference](https://github.com/GrapheneOS/platform_packages_apps_GmsCompat/blob/2026100600/src/app/grapheneos/gmscompat/GservicesProvider.java).
The device integration probe in `vendor-config/test` checks real provider
reads and rejected writes; separate shell and reboot checks verify caller
rejection and the real eSIM helper startup. This reserves the Gservices
authority in this base; adding full Google Services Framework would require
a separate integration design. Successful helper startup does not establish
carrier activation, firmware updating, or cellular calling acceptance.

Build `alpha_stallion_phone-cp2a-userdebug`, first checking `selinux_policy`,
then building `droid target-files-package`.
This is development preparation, not an approved flash package. A successful
APK build or lunch does not establish image boot, hardware acceptance, signed
updates, bootloader relocking, or stock restoration. The Pixel 11 preflight and
post-boot commands are not Pixel 10a admission tools.

### Physical Pixel 10a development result — October 11, 2026

The Eliza-based Alpha Android 17 image was built, flashed, and booted on
`stallion`. [The device evidence](evidence/pixel10a-development-2026-10-11.json)
records the exact archive and installed APK/library hashes. Alpha is the default
HOME, SELinux is enforcing, the two vendor metrics services remain running, and
the system eSIM helper starts without the missing-provider crash. The final
image contains the release launcher APK and system configuration provider;
temporary diagnostic services and the prototype provider APK are absent.

Both Android distribution variants build and pass APK verification. Local
verification passed 225 tests plus typecheck/web build, and the targeted
Clock/Home browser integration run passed 21 tests. Physical debug-APK tests
also covered shell reload, intercepted Clock handoffs, offline speech models,
and front/rear camera previews. These do not establish live agent inference,
carrier activation, connected network operation, or physical audio acceptance.

This installed image uses development keys and an unlocked bootloader. Private
release signing, OTA/rollback, stock restoration, and relocking remain
unqualified. The CI cleanup is locally verified; these uncommitted changes
have not run in GitHub CI.
