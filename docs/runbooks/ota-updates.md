# OS updates through A/B OTA: tonight's test-key update and the release pipeline (P-75, H-25)

Two tracks for updating the Alpha image on the owner's Pixel 10a (`stallion`, product
`alpha_stallion_phone`, userdebug test-keys, Virtual A/B, bootloader unlocked) through
`update_engine`. **Track 1** runs tonight with the keys the installed image already trusts and keeps
user data. **Track 2** is the secure release pipeline after the demo. Nothing in this runbook has
been run against keys, a builder, a cloud account or a device; every command is for the operator
it names.

Reused, not duplicated:

| Need | Existing |
| --- | --- |
| Release signing, the first full OTA, the compatibility record | `scripts/sign-aosp-release.mjs`, `scripts/aosp-release-record.mjs` ([staging](../pixel10a-staging.md#release-signing-ota-and-compatibility-record), [#672](672-pixel10a-production-image.md)) |
| Key ceremony, custody, enrollment | [#661](661-release-key-custody-ceremony.md), `scripts/enroll-release-keys.mjs` |
| Channel policy (certificates, known-good release, drill results) | `android/aosp/pixel10a-ota-channel.json` |
| Operator sideload update, interrupted resume, slot fallback, stock recovery | `scripts/aosp-ota-update.mjs`, [#673](673-pixel10a-device-day.md) |
| Retaining signed target-files | `scripts/aosp-retain-known-good.mjs` |

New here:

- `scripts/ota/generate-ota.sh` runs `ota_from_target_files` on an existing target-files and never
  signs one: Track 1's test-key full OTA, and Track 2's incremental OTA between two retained
  release-signed target-files (the GrapheneOS `generate-delta.sh` step). It refuses missing inputs,
  a non-A/B target and a key whose certificate is not in the target's (and source's)
  `SYSTEM/etc/security/otacerts.zip`, which `update_engine` verifies payloads against, and passes no
  wipe, downgrade or timestamp option.
- `packages/os/scripts/android/channel-manifest.mjs` (upstream, `elizaOS/eliza`) writes the channel
  manifest an `update_engine` client streams from: version, build fingerprint and date, rollout
  percent and, per package, URL, SHA-256, size, payload offset and size inside the zip and the four
  `payload_properties.txt` lines. Only HTTPS URLs, or a loopback http URL for adb reverse. It refuses
  an incremental that starts from an `eng.` build. It is the one writer for OS update channels; the
  schemaVersion 2 `publish-update-manifest.ts` format stays the factory-image install index.
- `packages/os/android/updater` (upstream, section 2.5) is the on-device update client. Alpha adds no
  updater code: its only input is an `updater` block in `pixel10a-alpha.json`. Until Alpha re-pins,
  both come from an Eliza checkout of `claude/os-updater-client-20261102` (`$ELIZA` below).

## Track 1: tonight, current test keys, user data kept

The cable OTA below also installs the update client (step 2a), so every later update reaches this
unit remotely (step 9).

### Guardrails

- **No fastboot** of any kind (`flash`, `update`, `-w`, `--set-active`, `erase`,
  `flashing lock`/`unlock`), no `adb reboot bootloader`, `adb reboot recovery` or `adb sideload`.
- **No wipe**: never `--wipe_user_data`, `--downgrade` (it forces a wipe) or `--override_timestamp`
  (generate-ota.sh accepts none of them), never a `POWERWASH=1` header, never
  `update_device.py --wipe-user-data`, no factory reset.
- **No lock or unlock**: the unit stays unlocked as it is (P-70).
- No `adb remount`, `adb disable-verity`/`enable-verity` or `bootctl set-active-boot-slot`.
- **Same keys as installed**: the build's own test key for the OTA, the AVB test key unchanged, and
  the Alpha APK in the image signed by the current development key (the 04:38 key) so it matches the
  installed copy.
- On any refusal, signer or key mismatch, or `update_engine` error: stop, leave the device on its
  current slot (`update_engine_client --reset_status` if it already reports `UPDATED_NEED_REBOOT`)
  and report. Do not retry with other flags.

### Inputs from the OS owner

| Input | Notes |
| --- | --- |
| `AOSP_SOURCE` | The verified stallion tree the installed image came from, `vendor/alphaphone` staged (2026-10-24 evidence: `/home/shaw/Android/pixel10a-preparation/...`) |
| Lunch target | The installed build's: `alpha_stallion_phone-cp2a-userdebug` |
| Staged launcher APK | Signed by the same development key as the installed Alpha app |
| `SERIAL` and the host the phone is attached to | That host serves the OTA (step 5) |
| Package key | The build's `default_system_dev_certificate`, normally `build/make/target/product/security/testkey` |
| Alpha checkout on the builder | This branch's `scripts/ota/generate-ota.sh` |
| `$ELIZA` on the builder | Eliza checkout of `claude/os-updater-client-20261102`; record its commit in the physical-product evidence |
| `CHANNEL_KEY` | Public half of the lab channel key, base64 Ed25519 SPKI DER. The owner or Root makes it offline (below). No key, no remote updates: stop before step 2a |
| `CHANNEL_MANIFEST_URL` | The https URL baked into this image (section 2.4). Payload URLs live in each manifest and can change later; this one changes only through an OS update |

The lab channel key, on an offline host with OpenSSL 3 (macOS LibreSSL cannot do this). The private
key never goes on the builder, in a repo or on an agent's machine. Losing it means no remote updates
until the next cable OTA. If it leaks, anyone can install a test-key OS on this unit, because the
test key is public.

```sh
openssl genpkey -algorithm ed25519 -out channel-lab.pem
openssl pkey -in channel-lab.pem -pubout -outform DER | base64 | tr -d '\n'   # CHANNEL_KEY, 60 characters
```

### 1. Read-only device checks

```sh
adb -s "$SERIAL" shell getprop ro.build.fingerprint     # .../eng.builde:userdebug/test-keys
adb -s "$SERIAL" shell getprop | grep -E 'ro\.([a-z_]+\.)?build\.date\.utc'   # the new build must be newer on every partition
adb -s "$SERIAL" shell getprop ro.boot.slot_suffix      # note it (_a or _b)
adb -s "$SERIAL" shell getprop ro.virtual_ab.enabled    # true
adb -s "$SERIAL" shell df -h /data                      # several GB free for the snapshot copy-on-write
adb -s "$SERIAL" exec-out cat /system/etc/security/otacerts.zip > device-otacerts.zip
adb -s "$SERIAL" shell pm path ai.elizaresearch.alphaphone
adb -s "$SERIAL" shell dumpsys package ai.elizaresearch.alphaphone | grep -E 'versionCode|codePath'
```

### 2a. Add the update client to the staged tree

Tonight's Alpha APK and SDK pin stay unchanged, so this is by hand. A composed build gets the same
result from the product's `updater` block. Removing the two make lines drops the updater again if it
does not compile.

```sh
cd "$AOSP_SOURCE"
cp -R "$ELIZA/packages/os/android/updater" vendor/alphaphone/updater
mkdir -p vendor/alphaphone/updater/res/values
cat > vendor/alphaphone/updater/res/values/channel.xml <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="channel" translatable="false">beta</string>
    <string name="channel_manifest_url" translatable="false">$CHANNEL_MANIFEST_URL</string>
    <string name="channel_key" translatable="false">$CHANNEL_KEY</string>
    <string name="launcher_certificate" translatable="false">0438dccb2d5e83fc2ad1ab11cbb882f837d97c4aee7cba72af9229c39b149b80</string>
</resources>
EOF
cat >> vendor/alphaphone/product.mk <<'EOF'

PRODUCT_PACKAGES += ElizaOsUpdater
SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS += vendor/alphaphone/updater/sepolicy/private
EOF
source build/envsetup.sh
lunch alpha_stallion_phone-cp2a-userdebug
get_build_var SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS   # must list vendor/alphaphone/updater/sepolicy/private
```

If `get_build_var` does not list it, the two policy rules are silently absent and the updater never
updates. Then add the line beside `SYSTEM_EXT_PUBLIC_SEPOLICY_DIRS` in the stallion `BoardConfig.mk`
(the hunk of `devices/pixel10a/patches/enforce-selinux.patch`).

### 2. Build the target-files on the existing builder

`BUILD_NUMBER` must be unique. Android runs default permission grants only when the fingerprint
changes, so with an unchanged `eng.` fingerprint the updater gets no `POST_NOTIFICATIONS` and
"Update ready" never appears; Alpha's own default-permission changes have the same issue. It also
makes later incrementals unambiguous: `channel-manifest.mjs` refuses to start one from an `eng.` build.

```sh
cd "$AOSP_SOURCE"
source build/envsetup.sh
lunch alpha_stallion_phone-cp2a-userdebug
export BUILD_NUMBER=$(date -u +%Y%m%d.%H%M)
m target-files-package otatools     # host limits: ../android-and-aosp.md#building-on-a-memory-constrained-host
ls "$ANDROID_PRODUCT_OUT"/obj/PACKAGING/target_files_intermediates/*-target_files*.zip   # exactly one
TF=/abs/path/printed/above.zip
sha256sum "$TF"
```

### 3. Check the build before generating (read-only)

```sh
unzip -p "$TF" META/misc_info.txt | grep -E '^(ab_update|virtual_ab|default_system_dev_certificate)='
unzip -p "$TF" SYSTEM/build.prop | grep -E '^ro\.build\.fingerprint='
unzip -p "$TF" SYSTEM/build.prop VENDOR/build.prop '*/etc/build.prop' | grep -E '^ro\.([a-z_]+\.)?build\.date\.utc='
unzip -p "$TF" SYSTEM/etc/security/otacerts.zip > tf-otacerts.zip
diff <(unzip -p tf-otacerts.zip | openssl x509 -noout -fingerprint -sha256) \
     <(unzip -p device-otacerts.zip | openssl x509 -noout -fingerprint -sha256)
unzip -l "$TF" | grep -E 'SYSTEM_EXT/priv-app/ElizaOsUpdater/|SYSTEM_EXT/etc/(permissions/ElizaOsUpdater|default-permissions/default-permissions-ai.elizaos.updater|sysconfig/ElizaOsUpdater-sysconfig)'
unzip -p "$TF" PRODUCT/app/AlphaPhone/AlphaPhone.apk > /abs/image-alpha.apk
adb -s "$SERIAL" exec-out cat <path from pm path> > /abs/installed-alpha.apk
apksigner verify --print-certs /abs/image-alpha.apk      # SDK build-tools or $ANDROID_HOST_OUT/bin
apksigner verify --print-certs /abs/installed-alpha.apk  # same certificate SHA-256 digest required
```

Stop unless: the updater's APK, allowlist, default-permissions and sysconfig files are all listed;
`ab_update=true` and `virtual_ab=true`; the fingerprint carries this build's `BUILD_NUMBER`; every `ro.<partition>.build.date.utc` (system,
vendor, product, system_ext, odm, where present) is **greater** than the device's, because
`update_engine` checks each partition (the 2026-10-24 evidence records an incremental build that kept an earlier timestamp; then
rebuild so the build properties regenerate, never `--downgrade`); the target's `otacerts.zip`
holds the device's certificate (the running build verifies the payload against it); both APKs have the same signer digest. With a higher versionCode in the image the system
copy replaces the installed update, otherwise the installed update stays; data is kept either way
because the signer is the same.

### 4. Generate the full OTA and its manifest (on the builder, from the Alpha checkout)

`OTA_DIR` is a scratch directory on the builder; never reuse AOSP's `OUT_DIR` name, which a later `m`
in the same shell would build into.

```sh
OTA_DIR=/abs/ota-lab-$(date -u +%Y%m%dT%H%MZ); mkdir "$OTA_DIR"
bash scripts/ota/generate-ota.sh --releasetools "$ANDROID_HOST_OUT/bin" \
  --package-key "$AOSP_SOURCE/build/make/target/product/security/testkey" \
  --target-files "$TF" --out "$OTA_DIR/ota.zip"
node "$ELIZA/packages/os/scripts/android/channel-manifest.mjs" --channel beta --version "lab-$(date -u +%Y%m%d)" --sequence 1 \
  --base-url http://127.0.0.1:8000/ --out "$OTA_DIR/manifest.json" "$OTA_DIR/ota.zip"
```

Check `buildFingerprint` (test-keys, stallion) and `buildDateUtc` (greater than the device's) in
`manifest.json`.

### 5. Serve over adb reverse (on the host the phone is attached to)

Copy `ota.zip` and `manifest.json` there if needed, set `OTA_DIR` on this host to the directory
holding them, and confirm the zip's SHA-256 equals
`updates[0].sha256`. `update_engine` streams `payload.bin` out of the zip with HTTP Range requests,
so the server must honour Range; `python3 -m http.server` ignores Range and must not be used. This
serves the one file, with Range, on loopback only:

```sh
adb -s "$SERIAL" reverse tcp:8000 tcp:8000
node -e '
const http = require("node:http"), fs = require("node:fs");
const file = process.argv[1], size = fs.statSync(file).size;
http.createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) return res.writeHead(416, {"Content-Range": `bytes */${size}`}).end();
  res.writeHead(range ? 206 : 200, {"Accept-Ranges": "bytes", "Content-Length": end - start + 1,
    ...(range && {"Content-Range": `bytes ${start}-${end}/${size}`})});
  fs.createReadStream(file, {start, end}).pipe(res);
}).listen(8000, "127.0.0.1");
' "$OTA_DIR/ota.zip"
```

AOSP's `system/update_engine/scripts/update_device.py` in the builder's tree (check its `--help`)
does steps 5 and 6 in one command with its own Range server and is an acceptable equivalent, never
with `--wipe-user-data`.

### 6. Apply with update_engine_client

```sh
adb -s "$SERIAL" root      # userdebug only; restarts adbd. Stock policy gives shell no binder call with update_engine
adb -s "$SERIAL" wait-for-device
M="$OTA_DIR/manifest.json"
URL=$(node -p "require('$M').updates[0].url")
OFFSET=$(node -p "require('$M').updates[0].payload.offset")
SIZE=$(node -p "require('$M').updates[0].payload.size")
HEADERS=$(node -p "require('$M').updates[0].payload.properties.join('\n')")
adb -s "$SERIAL" shell "update_engine_client --update --follow --payload=$URL --offset=$OFFSET --size=$SIZE --headers='$HEADERS'"
```

Expect progress, then `UPDATE_STATUS_UPDATED_NEED_REBOOT` and exit 0. Virtual A/B writes the
inactive slot through snapshots, whose copy-on-write may use space on `/data`; the running slot and
user data are not modified. Watch
`adb -s "$SERIAL" logcat -s update_engine` in another terminal. Before rebooting,
`ro.boot.slot_suffix` is still the old slot. Then `adb -s "$SERIAL" reboot`. If the phone is ringing or
in a call, wait.

### 7. Verify the slot switch

```sh
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 2; done'
adb -s "$SERIAL" shell getprop ro.boot.slot_suffix        # the other slot
adb -s "$SERIAL" shell getprop ro.build.date.utc          # = manifest buildDateUtc
adb -s "$SERIAL" shell getprop ro.build.fingerprint       # = manifest buildFingerprint
adb -s "$SERIAL" shell getenforce                         # Enforcing
adb -s "$SERIAL" shell getprop ro.boot.verifiedbootstate  # orange, as before (unlocked)
adb -s "$SERIAL" shell dumpsys package ai.elizaresearch.alphaphone | grep -E 'versionCode|codePath'
adb -s "$SERIAL" shell update_engine_client --merge       # returns when the Virtual A/B merge is done
adb -s "$SERIAL" shell getprop ro.control_privapp_permissions
adb -s "$SERIAL" shell pm path ai.elizaos.updater         # /system_ext/priv-app/ElizaOsUpdater/...
adb -s "$SERIAL" shell dumpsys package ai.elizaos.updater | grep -E 'android.permission.(REBOOT|POST_NOTIFICATIONS): granted=true'
adb -s "$SERIAL" shell dumpsys jobscheduler | grep -A3 ai.elizaos.updater
adb -s "$SERIAL" shell ls /system/etc/security/cacerts | wc -l
```

The updater runs only inside its job, so read its domain while it runs. This is the one step here that
starts something, a single check that reaches the channel; it applies nothing unless the channel
offers a build:

```sh
adb -s "$SERIAL" shell cmd jobscheduler run -f ai.elizaos.updater 1
adb -s "$SERIAL" shell ps -AZ | grep ai.elizaos.updater   # u:r:priv_app:..., never priv_app_36
adb -s "$SERIAL" logcat -d | grep -E 'avc: denied.*update_engine|ElizaOsUpdater'   # no denial
```

Pass: the other slot, the new date and fingerprint, Alpha is HOME with the owner still signed in and
their data present, both updater permissions granted, `priv_app`, no `update_engine` denial. A failed
updater never blocks the demo: it does nothing and says nothing. A missing or extra privapp allowlist
entry is different: under `enforce` it stops `system_server`, the new slot never completes boot and
the bootloader returns to the old slot (step 8).

### 8. Rollback

- **Before the reboot** (`UPDATED_NEED_REBOOT`): `adb -s "$SERIAL" shell update_engine_client --reset_status`
  cancels the slot switch; after a reboot the device runs the same slot and build. This is the only
  rollback to run on purpose tonight.
- **The new slot does not boot**: do nothing. The bootloader retries it and, because it was never
  marked successful, returns to the previous slot. Verify with step 7 that the slot and date are the
  old ones.
- **After the new slot booted and merged**, the previous slot's contents are gone (Virtual A/B).
  Rollback is a roll forward: rebuild the previous source (it gets a newer date) and repeat steps 2
  to 7.

### 9. The first remote update (test keys, no cable)

The owner or Root decides the host first (section 2.4). Build as steps 2 and 3 with a new
`BUILD_NUMBER`; the build date must be newer than the unit's.

```sh
bash scripts/ota/generate-ota.sh --releasetools "$ANDROID_HOST_OUT/bin" \
  --package-key "$AOSP_SOURCE/build/make/target/product/security/testkey" \
  --target-files "$TF" --out "$OTA_DIR/ota.zip"
sha256sum "$OTA_DIR/ota.zip"; du -h "$OTA_DIR/ota.zip"    # over 2 GiB rules out a GitHub release asset
node "$ELIZA/packages/os/scripts/android/channel-manifest.mjs" --channel beta --version "lab-$(date -u +%Y%m%d)" \
  --sequence <last beta sequence + 1> --base-url "https://<payload host>/stallion/lab-<date>/" \
  --out "$OTA_DIR/stallion-beta.json" "$OTA_DIR/ota.zip"
```

Upload `ota.zip` first and confirm a Range request returns 206. On the offline host, sign the exact
bytes and verify before upload (OpenSSL 3):

```sh
openssl pkeyutl -sign -rawin -inkey channel-lab.pem -in stallion-beta.json -out stallion-beta.json.sig
openssl pkey -in channel-lab.pem -pubout -out channel-lab.pub
openssl pkeyutl -verify -rawin -pubin -inkey channel-lab.pub -in stallion-beta.json -sigfile stallion-beta.json.sig
```

Publish `stallion-beta.json` and its `.sig` at `$CHANNEL_MANIFEST_URL`. On a GitHub release keep it a
**prerelease** with a fixed tag (create it once with `gh release create os-channel --prerelease`):

```sh
gh release upload os-channel stallion-beta.json stallion-beta.json.sig --clobber --repo eliza-research/alphaphone
```

The two files do not change atomically; a device that fetches between them refuses quietly and
retries. The unit takes the update on its next check (every 6 h on unmetered Wi-Fi with the battery
not low). To check now: `adb shell cmd jobscheduler run -f ai.elizaos.updater 1`. The owner then
sees one silent **Update ready** notification and taps **Restart**; during a ringing or active call
that tap does nothing and the notification stays. Verify with step 7. A later run sees the new build
and reports up to date.

## Track 2: after the demo, release keys

### 2.1 Keys (procedure only)

- **Offline store**: the #661 H-08 ceremony (custodian and witness, offline host,
  `generate-release-keys.ts`, encrypted bundle, two offline backups), then H-09 enrollment
  (`enroll-release-keys.mjs --write`), which fills the reviewed digests including the channel's
  `otaCertificateSha256` and `avbPublicKeySha256`. Under P-58 the encrypted keys then go to the CI
  `release` environment.
- **HSM**: P-16's original requirement, which P-58 relaxed; returning to it is an owner decision.
  Generate every key in the token as non-exportable (names and parameters from
  `android/signing/alpha-key-manifest.json`), export only certificates, AVB public keys and
  `avb_pkmd.bin`, enroll as above, and sign with the managed options `sign-aosp-release.mjs` already
  takes (`--pkcs11-config`, `--avb-signing-helper`, `--payload-signer`,
  `--payload-signer-signature-size`). Still missing: the AVB signing helper, the payload signer and a
  token signapk can use without a PIN on the command line (#661 D1, #672 finding 3). Signing then
  runs on a host attached to the token, not a hosted runner.
- **One new key**: the channel key (Ed25519) that signs channel manifests, made in the same ceremony
  and kept in the same store. It replaces the lab channel key (Track 1) in the image at the
  release-key reflash. The updater is built from source in the image, so `sign_target_files_apks`
  re-signs it with `releasekey`; it needs no signing lane of its own.

### 2.2 Sign and build the OTAs (per release N)

1. Build the unsigned `user` target-files (#672 H-21).
2. `node scripts/sign-aosp-release.mjs ... --dry-run`, then the real run (#672 H-22): signed
   target-files, full `ota.zip`, `release-record.json`, `avb_pkmd.bin`.
3. Retain N with `scripts/aosp-retain-known-good.mjs`. Keep every published release's signed
   target-files: they are the sources of later incrementals.
4. One incremental from each supported previous release P (GrapheneOS `generate-delta.sh`):

   ```sh
   bash scripts/ota/generate-ota.sh --releasetools /abs/otatools/bin --package-key /dev/shm/keys/releasekey \
     --target-files N/signed-target_files.zip --from P/signed-target_files.zip --out N/incremental-from-P.zip
   node scripts/aosp-release-record.mjs --signed-target-files N/signed-target_files.zip \
     --ota N/incremental-from-P.zip --incremental-from P/signed-target_files.zip --out N/incremental-from-P.record.json
   ```

5. `node scripts/aosp-ota-update.mjs check --from P/release-record.json --to N/release-record.json`
   refuses a build that is not newer, a lower patch level or rollback index, or changed keys.
6. The manifest, for the beta channel first:

   ```sh
   node vendor/eliza/packages/os/scripts/android/channel-manifest.mjs --channel beta --version 0.1.1 --sequence <last beta sequence + 1> \
     --base-url https://updates.example/alpha/stallion/releases/0.1.1/ --rollout-percent 5 \
     --out channels/beta.json N/ota.zip N/incremental-from-P.zip
   ```

GrapheneOS's `generate-release.sh` corresponds to steps 2 and 3 (factory images: #673 H-24).

### 2.3 Verified boot key, relock, and the one-time move of test-key units

Release keys change the platform certificate, the OTA key (`otacerts.zip`) and the AVB key. A test-key
unit verifies OTAs against the test key, and its data holds packages bound to the test platform
certificate, which Android does not migrate; the move is therefore **one reflash with a wipe**, never
an OTA. Locking wipes too, so do both in one session, with the unit owner's consent (P-70):

```sh
fastboot flash avb_custom_key N/avb_pkmd.bin    # while unlocked
# flash N's release-signed images: #673 H-24 (wipes user data)
fastboot flashing lock                          # production units, before first setup; pilot units stay unlocked (P-70)
```

A locked unit boots yellow and shows the key's hash (#673 D1); reverting needs
`fastboot flashing unlock` and `fastboot erase avb_custom_key` (wipes). The Alpha APK moves from the
development key to the release APK key (#662) in the same wipe; later APK key changes need APK
Signature Scheme v3 rotation (#661 D4). From then on every update is a release-key OTA, and locked
units enforce the AVB rollback indexes that `check` already guards.

### 2.4 Update server layout and the signed channel manifest

```text
https://updates.example/alpha/stallion/
  channels/stable.json        channel-manifest.mjs output, short cache (max-age=300)
  channels/stable.json.sig    Ed25519 signature over the exact bytes of stable.json
  channels/beta.json, channels/beta.json.sig
  releases/<version>/ota.zip                      immutable, long cache
  releases/<version>/incremental-from-<prev>.zip
  releases/<version>/release-record.json          public compatibility record
```

- Static origin behind a CDN, HTTPS only, Range requests honoured. No server logic.
- Sign offline after review, then verify before upload:
  `openssl pkeyutl -sign -rawin -inkey <channel key> -in stable.json -out stable.json.sig` (or the
  token's Ed25519). The client verifies the signature over the bytes before parsing them.
- **Staged rollout**: a device takes the release when the first 32 bits of
  `sha256(installId + version)` modulo 100 are below `rolloutPercent`; `installId` is a random value
  the updater creates once, never a hardware identifier. At publish time sign every planned step
  (for example 5, 25, 100) and a halted twin (0), so raising or halting never waits for the offline
  key. Each manifest carries a `sequence`: the steps get increasing sequences and the halted twin the
  highest, so lifting a halt needs a fresh offline signature.
- **Kill switch**: publish the halted twin. Devices that have not started do nothing. Work already
  started continues for now: cancelling a download and resetting an applied update need the applied
  payload id stored, which is deferred. A bad release is then fixed by rolling forward; downgrades
  stay refused (`downgradeAllowed: false`).
- Beta gets each release first; stable later gets a new manifest for the same release files.
- **Hosting (owner or Root decision, not implemented)**: a fixed-tag GitHub **prerelease** on public
  `eliza-research/alphaphone` can carry the manifest, for example
  `releases/download/os-channel/stallion-beta.json` plus `.sig`. It must be a prerelease: a full
  release becomes `releases/latest`, which the APK lane's `alpha-update-stable.json` URL resolves,
  and that URL would then 404 and withdraw its offer. Assets answer 302 then 206 with
  `Accept-Ranges: bytes`. GitHub limits an asset to 2 GiB; tonight's images zip is 1.7 GB compressed
  and 3.4 GB raw, so measure `ota.zip`. Above the limit the fastest viable payload host is a GCS
  bucket in the Alpha GCP project where the builder runs (`gcloud storage cp`, Range support, objects
  to 5 TiB, read-only object grant without listing); Cloudflare R2 is the alternative. Publicly
  hosting an OTA that contains Pixel vendor and firmware blobs is a separate owner decision.
- `update_engine` verifies the payload signature against the running build's `otacerts.zip` and the
  `FILE_HASH`/`METADATA_HASH` headers, so the CDN is never trusted with content. On a test-key unit
  the signed channel is the only real boundary, because the test key is public. The updater keeps
  the highest `sequence` it has accepted per channel and refuses a lower one, so a replayed earlier
  manifest cannot lift a halt or install an older build; it can only withhold an update.

### 2.5 The privileged update client

`packages/os/android/updater` upstream: OS behaviour every A/B elizaOS image needs. Alpha supplies only
product values, so its module budget is untouched. Unlike the listener there is no Alpha `android/`
module.

| Property | Decision |
| --- | --- |
| Package | `ai.elizaos.updater`, a separate small app, never part of `:app`. The Alpha app stays nonprivileged (P-75). |
| Build | Soong `android_app` from source in the image build, `sdk_version: system_current`, because `UpdateEngine` is `@SystemApi` and a Gradle profile targeting 36 would run in `priv_app_36`. The build's default certificate signs it. |
| Partition | `/system_ext/priv-app/ElizaOsUpdater`, installed for the system user only. This is the image's second privileged package, after the listener. |
| Privileged permissions | `REBOOT` only (`privapp_allowlist`). |
| Other permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, and `POST_NOTIFICATIONS` from a default-permissions file (`fixed="false"`). |
| Never | `READ_PHONE_STATE` (calls are seen through the audio mode, as the listener does), `RECOVERY`, `ACCESS_CACHE_FILESYSTEM` or `/data/ota_package` (the payload streams by URL), `INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS`. |
| SELinux | Stock `priv_app` cannot reach `update_engine`: only `gmscore_app`, `system_app` (the stable service) and `system_server` can, and `update_engine` checks no caller itself. Two rules in system_ext private policy: `allow priv_app update_engine_service:service_manager find;` and `binder_call(priv_app, update_engine)`. On test keys that adds nothing, because the platform key and test key are public. Before release keys, move to a dedicated domain through system_ext `seapp_contexts` and drop this grant (the G7 pattern). |
| Platform API | `android.os.UpdateEngine`: `bind`, `applyPayload(url, offset, size, headers)`, `unbind`. |
| Status | `content://ai.elizaos.updater.status`, `call("status")`, guarded by `ai.elizaos.updater.permission.READ_STATUS` (`signature\|knownSigner`, bound to the launcher certificate) and re-checked in `call()`. |

Behaviour:

1. **Check**: one persisted periodic job, scheduled at `BOOT_COMPLETED`: unmetered network, battery
   not low, every 6 h with 2 h flex, linear backoff of 15 min. Each run binds `UpdateEngine`, which
   reports its status at once.
2. **Manifest** (idle only): fetch at most 64 KiB and `<url>.sig` on the job's network. Verify the
   Ed25519 signature over the exact bytes before parsing, against the key in this image. Accept only
   schema 1, this channel, `Build.DEVICE`, and a `sequence` at or above the highest accepted (stored
   when higher, even when halted). Then offer only inside the rollout bucket, with `buildDateUtc`
   newer than `ro.build.date.utc`, and with the same brand, product, device, type and tags as the
   booted fingerprint, so test-keys goes only to test-keys. Pick the incremental whose `from` is
   `Build.FINGERPRINT`, otherwise the full package; its URL must be https.
3. **Download**: `applyPayload` with exactly `FILE_HASH`, `FILE_SIZE`, `METADATA_HASH` and
   `METADATA_SIZE` and the client's own `NETWORK_ID`, which keeps the transfer off cellular. Nothing
   else passes, because `update_engine` would obey `POWERWASH`, `SPL_DOWNGRADE` and other headers.
   `update_engine` downloads and applies on its own. A transfer lost to the network or a reboot
   resumes when a later run calls `applyPayload` with the same hashes; `update_engine` reports
   `NOT_ENOUGH_SPACE` itself, so there is no `allocateSpace`.
4. **Ready**: on `UPDATED_NEED_REBOOT`, one silent "Update ready" notification with a **Restart**
   action. There is no automatic or overnight restart yet.
5. **Never during a call**: the audio mode is read immediately before rebooting. Only `MODE_NORMAL`
   restarts; any ringing, call or communication mode does nothing and leaves the notification.
6. **No error text**: no failure toast, dialog or notification anywhere. A failed run ends quietly
   and the next one retries. Status is state only: up-to-date, downloading or ready, and a version.
   A later APK update can show it in Settings > About through a shared upstream plugin, not a new
   Alpha plugin.
7. **After restart** the client does nothing: `update_engine` schedules the Virtual A/B merge itself
   and the next run sees the new build.

An unattended restart leaves the phone locked before its first unlock, when apps that are not
direct-boot aware (Alpha's agent, reminders) cannot run. Resume on Reboot
(`RecoverySystem.prepareForUnattendedUpdate`, `rebootAndApply`) avoids that only where a
reboot-escrow provider exists, which must be verified on stallion without Google services. Until it
is, the "Update ready" notification is the only restart path.

Deferred until after the demo: the dedicated SELinux domain; a kill switch that acts on work already
started; skipping a payload that failed permanently (today it re-downloads every period);
`suspend()` on a low battery; overnight restart; publishing incrementals; the Settings status row.

### 2.6 H-25 drills

Run on the drill unit (#673 D3) with releases N and N+1 (#673 D4). #673 H-25 runs the four channel
drills through the operator sideload path; P-75 makes `update_engine` the field path, so each drill
also runs through it (the updater, or `update_engine_client` with the release manifest as in Track 1
steps 5 to 7):

| Drill | Field path | Pass |
| --- | --- | --- |
| `signedUpdate` | N to N+1 from the beta manifest at 100 | Other slot, N+1's date and fingerprint, enforcing, verified boot yellow (locked) or orange (pilot), data kept |
| `interruptedUpdate` | Wi-Fi off mid-download; a reboot mid-download; power held off during apply | Stays on N until complete, continues without help, ends on N+1, shows no error |
| `compatibleRollback` | `resetStatus` after `UPDATED_NEED_REBOOT`; a drill-only N+1 that never completes boot; after the merge, N+2 rebuilt from N's source | Stays on N; the bootloader returns to N; N+2 passes `check` and installs, and a lower build is refused (record it) |
| `stockRecovery` | Unchanged: #673 H-25 step 4 (wipes, consent, #673 D2) | `verify-stock` passes |

Also record in the same drill records: the kill switch (0 stops an unstarted update), a device
outside the rollout bucket doing nothing, no restart during a ringing or active call, and a lost
Wi-Fi network ending the transfer until a later run resumes it, never on cellular. Evidence, the
`signedUpdateRecovery` gate and the channel's `drills` are recorded as #673 describes.

## Open points

1. Unverified on stallion: that the target-files carries `SYSTEM/etc/security/otacerts.zip` with the
   test key's certificate (generate-ota.sh refuses otherwise). The whole updater is unverified on a
   device: Soong build, policy, grants, `update_engine` calls and the notification.
2. A build whose date is not newer than the device's is refused by `update_engine`; the fix is a
   rebuild, never `--downgrade`.
3. generate-ota.sh signs incrementals with key files only; managed signing needs a payload signer
   option there when the HSM path is chosen. Moving it upstream next to `channel-manifest.mjs` is
   deferred.
4. `pixel10a-alpha.json` gets its `updater` block (`channel`, `manifestUrl`, `channelKey`) once the
   host and lab key exist; a composed build stages no updater before that.
5. Manifests carry a `sequence` but no expiry, so a replay of the current manifest can withhold a
   newer one; an enforced `expiresAt` needs scheduled re-signing.
6. Resume on Reboot and the updater's dedicated SELinux domain need stallion verification before
   overnight restarts.
7. Whether the APK lane's `alpha-update/v1` duplicates upstream's plugin-native-agent updater and
   ota-trust APK descriptors is a separate owner decision. The APK lane cannot share a fetch helper
   with this client: it runs in Alpha's process, built by Gradle, and this is a separate Soong app.
