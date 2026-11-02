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
  a non-A/B target and a key that is not the target's (and source's) `update_engine` payload key,
  and passes no wipe, downgrade or timestamp option.
- `scripts/ota/make-channel-manifest.mjs` (test: `test/ota-channel-manifest.test.mjs`) writes the
  channel manifest an `update_engine` client streams from: version, build fingerprint and date,
  rollout percent and, per package, URL, SHA-256, size, payload offset and size inside the zip and
  the four `payload_properties.txt` lines. Only HTTPS URLs, or a loopback http URL for adb reverse;
  a test-keys build is accepted only for loopback.

## Track 1: tonight, current test keys, user data kept

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
| Alpha checkout on the builder | This branch's `scripts/ota/` with `vendor/eliza` at the pin (the manifest writer reuses the shared release-record helpers) |

### 1. Read-only device checks

```sh
adb -s "$SERIAL" shell getprop ro.build.fingerprint     # .../eng.shaw:userdebug/test-keys
adb -s "$SERIAL" shell getprop ro.build.date.utc        # the new build must be newer
adb -s "$SERIAL" shell getprop ro.boot.slot_suffix      # note it (_a or _b)
adb -s "$SERIAL" shell getprop ro.virtual_ab.enabled    # true
adb -s "$SERIAL" shell df -h /data                      # several GB free for the snapshot copy-on-write
adb -s "$SERIAL" exec-out cat /system/etc/update_engine/update-payload-key.pub.pem > device-payload-key.pub.pem
adb -s "$SERIAL" shell pm path ai.elizaresearch.alphaphone
adb -s "$SERIAL" shell dumpsys package ai.elizaresearch.alphaphone | grep -E 'versionCode|codePath'
```

### 2. Build the target-files on the existing builder

```sh
cd "$AOSP_SOURCE"
source build/envsetup.sh
lunch alpha_stallion_phone-cp2a-userdebug
m target-files-package otatools     # host limits: ../android-and-aosp.md#building-on-a-memory-constrained-host
ls "$ANDROID_PRODUCT_OUT"/obj/PACKAGING/target_files_intermediates/*-target_files*.zip   # exactly one
TF=/abs/path/printed/above.zip
sha256sum "$TF"
```

### 3. Check the build before generating (read-only)

```sh
unzip -p "$TF" META/misc_info.txt | grep -E '^(ab_update|virtual_ab|default_system_dev_certificate)='
unzip -p "$TF" SYSTEM/build.prop | grep -E '^ro\.build\.(fingerprint|date\.utc)='
unzip -p "$TF" SYSTEM/etc/update_engine/update-payload-key.pub.pem | diff - device-payload-key.pub.pem
unzip -p "$TF" PRODUCT/app/AlphaPhone/AlphaPhone.apk > /abs/image-alpha.apk
adb -s "$SERIAL" exec-out cat <path from pm path> > /abs/installed-alpha.apk
apksigner verify --print-certs /abs/image-alpha.apk      # SDK build-tools or $ANDROID_HOST_OUT/bin
apksigner verify --print-certs /abs/installed-alpha.apk  # same certificate SHA-256 digest required
```

Stop unless: `ab_update=true` and `virtual_ab=true`; `ro.build.date.utc` is **greater** than the
device's (the 2026-10-24 evidence records an incremental build that kept an earlier timestamp; then
rebuild so the build properties regenerate, never `--downgrade`); the payload key equals the
device's; both APKs have the same signer digest. With a higher versionCode in the image the system
copy replaces the installed update, otherwise the installed update stays; data is kept either way
because the signer is the same.

### 4. Generate the full OTA and its manifest (on the builder, from the Alpha checkout)

```sh
OUT_DIR=/abs/ota-lab-$(date -u +%Y%m%dT%H%MZ); mkdir "$OUT_DIR"
bash scripts/ota/generate-ota.sh --releasetools "$ANDROID_HOST_OUT/bin" \
  --package-key "$AOSP_SOURCE/build/make/target/product/security/testkey" \
  --target-files "$TF" --out "$OUT_DIR/ota.zip"
node scripts/ota/make-channel-manifest.mjs --channel beta --version "lab-$(date -u +%Y%m%d)" \
  --base-url http://127.0.0.1:8000/ --out "$OUT_DIR/manifest.json" "$OUT_DIR/ota.zip"
```

Check `buildFingerprint` (test-keys, stallion) and `buildDateUtc` (greater than the device's) in
`manifest.json`.

### 5. Serve over adb reverse (on the host the phone is attached to)

Copy `ota.zip` and `manifest.json` there if needed and confirm the zip's SHA-256 equals
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
' "$OUT_DIR/ota.zip"
```

AOSP's `system/update_engine/scripts/update_device.py` in the builder's tree (check its `--help`)
does steps 5 and 6 in one command with its own Range server and is an acceptable equivalent, never
with `--wipe-user-data`.

### 6. Apply with update_engine_client

```sh
M="$OUT_DIR/manifest.json"
URL=$(node -p "require('$M').updates[0].url")
OFFSET=$(node -p "require('$M').updates[0].payload.offset")
SIZE=$(node -p "require('$M').updates[0].payload.size")
HEADERS=$(node -p "require('$M').updates[0].payload.properties.join('\n')")
adb -s "$SERIAL" shell "update_engine_client --update --follow --payload=$URL --offset=$OFFSET --size=$SIZE --headers='$HEADERS'"
```

Expect progress, then `UPDATE_STATUS_UPDATED_NEED_REBOOT` and exit 0. Virtual A/B writes the
inactive slot through snapshots; the running system and `/data` are not touched. Watch
`adb -s "$SERIAL" logcat -s update_engine` in another terminal. If this build refuses the shell's
binder call to `update_engine`, run `adb -s "$SERIAL" root` once (userdebug; it restarts adbd only)
and repeat. Before rebooting, `ro.boot.slot_suffix` is still the old slot. Then
`adb -s "$SERIAL" reboot`.

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
```

Eng-style builds keep `eng.shaw` in the fingerprint, so the build date and slot are the proof. Pass:
the other slot, the new date, Alpha is HOME with the owner still signed in and their data present.

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
  and kept in the same store. The updater APK is signed with the existing Alpha release APK key, as
  the listener is.

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
   node scripts/ota/make-channel-manifest.mjs --channel beta --version 0.1.1 \
     --base-url https://updates.example/alpha/stallion/releases/0.1.1/ --rollout-percent 5 \
     --out channels/beta.json N/ota.zip N/incremental-from-P.zip
   ```

GrapheneOS's `generate-release.sh` corresponds to steps 2 and 3 (factory images: #673 H-24).

### 2.3 Verified boot key, relock, and the one-time move of test-key units

Release keys change the platform certificate, the OTA and payload key and the AVB key. A test-key
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
  channels/stable.json        make-channel-manifest.mjs output, short cache (max-age=300)
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
  key.
- **Kill switch**: publish the halted twin. Devices that have not started do nothing, a running
  download is cancelled and an applied update waiting for restart is reset. A bad release is then
  fixed by rolling forward; downgrades stay refused (`downgradeAllowed: false`).
- Beta gets each release first; stable later gets a new manifest for the same release files.
- `update_engine` verifies the payload signature against the installed payload key and the
  `FILE_HASH`/`METADATA_HASH` headers, so the CDN is never trusted with content. A replayed older
  manifest can only withhold an update, never install an older build.

### 2.5 The privileged update client

Upstream first (#680, PR outline 5B/5C), then bound by Alpha the way the listener is
([ADR 0001](../adr/0001-privileged-listener.md)):

| Property | Decision |
| --- | --- |
| Package | A separate small updater APK, never part of `:app`. The Alpha app stays nonprivileged (P-75). |
| Partition | `system_ext` privileged, presigned with the Alpha release APK key. |
| Privileged permissions | `REBOOT` only; `RECOVERY` only if Resume on Reboot is adopted (below). |
| Other permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS` (pre-granted by the image). |
| Never | `READ_PHONE_STATE` (calls are seen through the audio mode, as the listener does), `ACCESS_CACHE_FILESYSTEM` or `/data/ota_package` (the payload streams by URL), `INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS`. |
| SELinux | Lookup of `update_engine_service` and binder calls with `update_engine` only. Check whether stock `priv_app` allows them on the stallion tree; the target is a dedicated domain through `seapp_contexts` and a seinfo bound to the updater's certificate (the G7 pattern). |
| Platform API | `android.os.UpdateEngine`: `applyPayload(url, offset, size, headers)`, `suspend`, `resume`, `cancel`, `resetStatus`, `allocateSpace`, `cleanupAppliedPayload`. |

Behaviour:

1. **Check** every few hours (jittered job) on an unmetered network: fetch the channel manifest and
   signature, verify, and accept only this device, this channel, a `buildDateUtc` newer than
   `ro.build.date.utc` and a rollout bucket inside `rolloutPercent`. Pick the incremental whose
   `from` is `Build.FINGERPRINT`, otherwise the full package.
2. **Download in the background on Wi-Fi**: `allocateSpace` first, then `applyPayload` with the
   manifest's URL, offset, size and properties. Losing the unmetered network or a low battery
   suspends; their return resumes. `update_engine` keeps progress across reboots.
3. **Ready**: on `UPDATED_NEED_REBOOT`, one silent "Update ready" notification with a **Restart**
   action. Overnight install restarts the phone only while charging, idle, screen off, inside the
   night window and not in a call.
4. **Never during a call**: the audio mode is checked immediately before every restart; a ringing or
   active call defers the restart to the next window.
5. **No error text**: no failure toast, dialog or notification anywhere. Failures back off and retry
   at the next check; a release that keeps failing waits for the next manifest. Status is state only
   (up to date, downloading, ready to restart, version), readable by Alpha through a provider guarded
   by a signature permission (like the listener's control provider), so Settings > About can replace
   the development-only `updateChannelCheckEnabled` row through a Capacitor plugin built like
   `AlphaConnectionPlugin.java`.
6. **After restart** the boot control marks the slot successful after a full boot, the merge runs in
   the background and `cleanupAppliedPayload` follows.

An unattended restart leaves the phone locked before its first unlock, when apps that are not
direct-boot aware (Alpha's agent, reminders) cannot run. Resume on Reboot
(`RecoverySystem.prepareForUnattendedUpdate`, `rebootAndApply`) avoids that only where a
reboot-escrow provider exists, which must be verified on stallion without Google services. Until it
is, the default is the "Update ready" notification and overnight restart stays off.

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

Also record in the same drill records: the kill switch (0 stops an unstarted update, cancels a
download, resets an applied one), a device outside the rollout bucket doing nothing, no restart
during a ringing or active call, and a metered network suspending the download. Evidence, the
`signedUpdateRecovery` gate and the channel's `drills` are recorded as #673 describes.

## Open points

1. Unverified on stallion: the shell's binder access to `update_engine` on this userdebug build
   (`adb root` fallback), and the payload key path in its target-files (generate-ota.sh refuses when
   absent).
2. A build whose date is not newer than the device's is refused by `update_engine`; the fix is a
   rebuild, never `--downgrade`.
3. generate-ota.sh signs incrementals with key files only; managed signing needs a payload signer
   option there when the HSM path is chosen.
4. The channel manifest is separate from the shared schemaVersion 2 install manifest
   (`publish-update-manifest.ts`); move the writer upstream with the updater.
5. Manifests carry no expiry, so a replay can withhold updates; an enforced `expiresAt` needs
   scheduled re-signing.
6. Resume on Reboot and the updater's SELinux domain need stallion verification before overnight
   restarts.
