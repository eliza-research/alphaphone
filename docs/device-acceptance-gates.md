# Device acceptance gates

Decision P-58 ([decisions](decisions.md)) replaces "personal visual review" and "user acceptance"
with automated gates run on the Alpha Cuttlefish image and an attached Pixel 10a by the self-hosted
`alpha-device` runner. This page lists the two gates in this repository, what each one proves and
what it does not. A gate passes only on an executed run. A skipped, mocked or simulated run is not a
pass, and the evidence classes of [verification](verification.md) stay separate: an APK build (B),
an emulator run (E), the Cuttlefish image (I) and a physical device (D) each prove only their own class.

## Instrumentation on a device target

```sh
npm run test:android:instrumentation -- --device-target cuttlefish --serial 127.0.0.1:6520 \
  --allow-reinstall --classes NoMockProduct,Shell,StartupReadiness
npm run test:android:instrumentation -- --device-target pixel --serial <USB serial> \
  --allow-reinstall [--home-role --classes Shell,LauncherHome,SettingsRoles]
```

`scripts/android-instrumentation.mjs` keeps its emulator path (`--owned-emulator --avd`, serial
`emulator-NNNN`, `ro.kernel.qemu`/`ro.boot.qemu`) unchanged. `--device-target` replaces those
options and is refused together with them. Admission before anything is installed:

- `cuttlefish`: a loopback adb endpoint (`127.0.0.1:NNNN`) only; `ro.product.name` must be the
  Alpha Cuttlefish product (`alpha_cf_x86_64_phone` or `alpha_cf_arm64_phone`), `ro.hardware`
  `cutf_*` and `ro.product.device` `vsoc_*`. The record is class I (`cuttlefish-image-instrumentation`).
- `pixel`: a USB serial only (no `host:port`, no `emulator-NNNN`), `ro.serialno` equal to that
  serial and `ro.product.device` `stallion` (Pixel 10a). The record is class D (`physical-device-instrumentation`).
- Both refuse a booting device and anything reporting `ro.kernel.qemu=1` or `ro.boot.qemu=1`, and
  take the serial only from `--serial`, never `ANDROID_SERIAL`.

The runner installs both variants, clears Alpha's data before every class and uninstalls at the end.
On a device target that needs `--allow-reinstall`; without it the run stops before any adb command.
With it, an Alpha installation that was already there is replaced (`install -r`) and named in
`device.replacedPackages`; its data is lost, and on the Cuttlefish image the final uninstall leaves
the image's own system copy of Alpha. The test APK must be signed with the installed app's key, so
on the image the APK pair must come from the image's signer. Refused on a device target: `--test-mocks`
builds, `--clock-exclusive`, the secondary-user classes and the classes that set a fixture screen
lock (PasswordVaultSettings, PasswordVaultFill). `--home-role` uses the emulator's admission and
restoration unchanged: one stock HOME holder must hold the role before the run, and the original
holder is put back and read back; an unproven restoration fails the run and keeps the installation
for recovery (`home-role-recovery.json`).

`scripts/instrumentation-result.mjs` derives `evidenceClass`, `evidence` and `notEvidenceFor` from
the target and writes them after the caller's fields, so a record cannot be relabelled. A class E
record carries `emulator` and no `device`; a class I or D record carries the admitted `device`
identity (target, product, device, model, hardware, build fingerprint and type, SDK, ABI, serial
SHA-256) and no `emulator`.

What it proves: the named classes passed on that image fingerprint or that physical device, with
the recorded APK bytes. What it does not prove: other images, builds or device models, real
integrations (class R), the emulator class, or anything a class does not assert.

## Per-view screenshot gate

```sh
node scripts/device-view-capture.mjs --device-target cuttlefish --serial 127.0.0.1:6520 \
  --output test-results/device-views/<run> [--baseline <dir>] [--max-diff-percent 1]
node scripts/device-view-capture.mjs --device-target pixel --serial <USB serial> \
  --output test-results/device-views/<run> --baseline <dir> --update-baseline
node scripts/device-view-capture.mjs --device-target cuttlefish --serial 127.0.0.1:6520 \
  --output <dir> --observe-only
```

The gate drives the Alpha build that is already installed: it installs, clears and uninstalls
nothing and uses no test-mocks hook or instrumentation. The production bundle has no deep link or
route per view, so the gate uses the product's own buttons: it starts `MainActivity`, finds the
view's button on Home, or "Open <view>" in the All apps dialog, in `uiautomator dump`, and taps its
centre. The views are Home and the root views of `test/browser/root-view-states.spec.ts`
(Inbox, Calendar, Browser, Camera, Photos, Maps, Notes, Files, Workflows, Settings); a test keeps
the two lists equal. Each view is captured with `adb exec-out screencap -p` in light and dark
(`cmd uimode night no|yes`). The original night mode must be `yes` or `no`; it is put back and read
back, and a restoration that cannot be proven fails the run.

Automated checks per image, each a failure of that view:

- the PNG is not blank or uniform (one colour over 99.5% of the compared rows, or almost no
  luminance variation);
- no crash or ANR dialog in `dumpsys window`, and Alpha owns the focused window;
- no new Alpha entry in the crash log buffer (`logcat -b crash -d`) and the app process did not
  restart during the view (`pidof`);
- the view's landmark (a non-clickable node whose accessible name contains the view name, the rule
  of `root-view-states.spec.ts`) is in the UI dump, the production sign-in gate is not showing, and
  the screen changed from Home by at least 1% of pixels;
- with `--baseline <dir>`: the share of changed pixels (any RGB channel off by more than 16, the
  threshold of `scripts/compare-prototype.py`) against `<dir>/<theme>-<view>.png` is at most
  `--max-diff-percent` (default 1). The top and bottom 5% of rows (status and navigation bars) are
  excluded (`--ignore-top-percent`, `--ignore-bottom-percent`); a difference image is written per
  compared view. A missing baseline image or a size mismatch fails the view.

The PNG decoding and comparison are plain JavaScript on `node:zlib`; no image dependency is added.
`--update-baseline` (only with `--baseline`) copies the images of a run that passed every other
check into the baseline directory with a `baseline.json` naming the device, fingerprint, app and
image hashes. A failing run writes no baseline. Baselines are committed only from a recorded run.

`<output>/manifest.json` records the evidence class (I `cuttlefish-image-view-capture`, D
`physical-device-view-capture`), the admitted device identity, the installed app (version name and
code, APK path, on-device APK SHA-256, the dumpsys signer token, and the apksigner certificate
SHA-256 of the pulled APK, or `null` with the reason when the pulled bytes differ or apksigner
fails), the settings, each image's file, SHA-256, size, UI dump, navigation path and check results,
and `passed`, which requires every requested view in every theme and a restored night mode. The
output directory must be new, and the manifest is never overwritten.

`--observe-only` sends no start, tap, key or night-mode change: it captures the screen as it is and
runs the same checks once. It is for validating the capture against a shared device and is never a
pass of the gate (`passed: false`).

What it proves: on that device and build, each listed view was reached through the product's own
UI, rendered something other than a blank screen, raised no crash or ANR, showed its landmark and,
with a baseline, matched it within the threshold. What it does not prove: that the content is
correct or useful (a baseline is only as good as the run that wrote it), states other than each
view's first screen, scrolling, keyboard, gestures or text scale, real account data, or the emulator
and browser lanes. Signed out, a production build covers Home with the required Eliza Cloud sign-in,
so every view fails with "signed-out"; the gate needs a device signed in to an owned account, which
is set up outside this repository and never by the gate.

## Read-only check on the shared Cuttlefish (2026-10-26)

The capture was exercised against the running Alpha Cuttlefish at `127.0.0.1:6520` with read-only
adb only (getprop, `pm path`, `dumpsys package`/`window`, `sha256sum`, `adb pull` of the APK,
`logcat -d`, `pidof`, `cmd uimode night` without an argument, `screencap`, `uiautomator dump`),
through `runCapture` with `--observe-only` and without the device lease, since other sessions were
using the device. Observed: product `alpha_cf_x86_64_phone`, device `vsoc_x86_64_only`, hardware
`cutf_cvm`, fingerprint `Alpha/alpha_cf_x86_64_phone/vsoc_x86_64_only:Baklava/CP2A.260605.016/eng.shaw:userdebug/test-keys`,
SDK 37, Alpha 0.1.0 (versionCode 1) as an updated system app at a `/data/app` path, APK SHA-256
`b963717c4fd3b251a88405ced7e0a02becb36ff186e384adc8d52f7c8ee65a80` (536 MB, so the APK is pulled to a
file rather than read through a pipe), signer certificate SHA-256
`2242994d2d237f98d01927999157067df4e2495a8f980451ac3de5d40642584a`. The screen was the production
Eliza Cloud sign-in gate with "Local agent startup did not complete"; the checks found it not blank,
Alpha focused, no crash dialog or crash entry, and identified the screen as `sign-in`. No view was
navigated, no night mode was changed and no instrumentation ran, so this is not a pass of either
gate and records no class I evidence.
