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
  both come from a copy of Eliza's `packages/os` (`$ELIZA` below).

Source pins, one row per lane, since the OS update and the app update have separate source,
artifact and acceptance gates:

| Lane | Source |
| --- | --- |
| OS update client and `channel-manifest.mjs` | Eliza `claude/os-updater-client-20261102`, at the commit in `$ELIZA` below |
| This runbook and `generate-ota.sh` | Alpha `claude/os-updater-alpha-20261102`, this branch; `generate-ota.sh` at the commit in `$ALPHA` below |
| App updater (in Alpha's process, the APK lane) | Alpha `claude/app-updater-20261102` at `0ead71fc54`. Its composition onto `bcdefded45` (`8c30b83c51` on `codex/app-updater-bcdef-ff04-source-20261104`) is a future source snapshot only, not the current app candidate. This runbook neither builds nor selects it |
| Current app candidate (2026-11-04) | Alpha `bcdefded45`, SDK (`vendor/eliza`) `ff04a55874`. It carries none of the OS update client, `channel-manifest.mjs` or this runbook. This runbook neither builds nor selects it |

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
  current slot (`su 0 update_engine_client --reset_status` if it already reports `UPDATED_NEED_REBOOT`)
  and report. Do not retry with other flags.

### Inputs from the OS owner

| Input | Notes |
| --- | --- |
| `AOSP_SOURCE` | The verified stallion tree the installed image came from, `vendor/alphaphone` staged (2026-10-24 evidence: `/home/shaw/Android/pixel10a-preparation/...`) |
| Lunch target | The installed build's: `alpha_stallion_phone-cp2a-userdebug` |
| Staged launcher APK | Signed by the same development key as the installed Alpha app |
| `SERIAL` and the host the phone is attached to | That host runs steps 1 and 5 to 8 and serves the OTA (step 5) |
| Package key | The build's `default_system_dev_certificate`, normally `build/make/target/product/security/testkey` |
| `$ALPHA` on the builder | `scripts/ota/generate-ota.sh` of this branch, `claude/os-updater-alpha-20261102`, at commit `2e3b3c779d`. Copy it from a clone that has the commit (the branch is on GitHub): `git -C <alpha> archive 2e3b3c779d scripts/ota/generate-ota.sh \| ssh <builder> tar -x -C "$ALPHA"` |
| `$ELIZA` on the builder | `packages/os` of Eliza `claude/os-updater-client-20261102` at commit `e7781ac1e1`. Copy it from a clone that has the commit (the branch is on GitHub): `git -C <eliza> archive e7781ac1e1 packages/os \| ssh <builder> tar -x -C "$ELIZA"`. Node and `unzip` are its only needs. Record the commit in the physical-product evidence |
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
adb -s "$SERIAL" shell 'command -v update_engine_client'  # required by steps 6 and 7
adb -s "$SERIAL" shell getprop zygote.critical_window.minute                  # record it, empty or not
adb -s "$SERIAL" shell 'su 0 sh -c "grep -h checkpoint= /vendor/etc/fstab.*"'  # record it: the /data line
adb -s "$SERIAL" shell df -h /data                      # several GB free for the snapshot copy-on-write
adb -s "$SERIAL" exec-out cat /system/etc/security/otacerts.zip > /abs/device-otacerts.zip
adb -s "$SERIAL" shell pm path ai.elizaresearch.alphaphone
adb -s "$SERIAL" exec-out cat <path from pm path> > /abs/installed-alpha.apk
adb -s "$SERIAL" shell dumpsys package ai.elizaresearch.alphaphone | grep -E 'versionCode|codePath'
```

These run on the host the phone is attached to. When that is not the builder, copy
`device-otacerts.zip` and `installed-alpha.apk` to the builder for step 3.

The two recorded lines say what a boot failure looks like (step 8). With
`zygote.critical_window.minute` empty or `off`, `zygote` is not a critical service, so a framework
crash loop never reboots the phone by itself. A `checkpoint=` flag means `update_verifier` leaves the
slot's success mark to the end of boot. Without one, `update_verifier` can mark the new slot before
the framework starts, if this image runs it, and a framework failure would not fall back: tell the OS
owner before step 6.

### 2a. Add the update client to the staged tree

Tonight's Alpha APK and SDK pin stay unchanged, so this is by hand. A composed build appends the same
two make lines from the product's `updater` block, after checking the channel key and URL. If the
updater does not compile, remove the two make lines and `rm -rf vendor/alphaphone/updater`: Soong
parses every `Android.bp` in the tree, so the make lines alone do not take it out of the build. That
build can still go on by cable, but it takes no remote updates: skip the updater rows of step 3, the
channel steps at the end of step 4 and the updater rows of step 7, and record that it shipped without
the client.

The parentheses make the guard stop a pasted block: at an interactive prompt it would otherwise print
its error and the next line would still run.

```sh
(
: "${CHANNEL_KEY:?}" "${CHANNEL_MANIFEST_URL:?}"
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
)
cd "$AOSP_SOURCE"
source build/envsetup.sh
lunch alpha_stallion_phone-cp2a-userdebug
get_build_var SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS   # must list vendor/alphaphone/updater/sepolicy/private
```

If `get_build_var` does not list it, the updater's SELinux domain is silently absent, the updater runs
in stock `priv_app` and never updates. Then add the line beside `SYSTEM_EXT_PUBLIC_SEPOLICY_DIRS` in the stallion `BoardConfig.mk`
(the hunk of `devices/pixel10a/patches/enforce-selinux.patch`).

### 2. Build the target-files on the existing builder

`BUILD_NUMBER` must be unique. Android runs default permission grants only when the fingerprint
changes, so with an unchanged `eng.` fingerprint the updater gets no `POST_NOTIFICATIONS`, so
"Update ready" never appears, and no `READ_PHONE_STATE`, so **Restart** does nothing; Alpha's own
default-permission changes have the same issue. It also
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
unzip -p "$TF" META/ab_partitions.txt    # what the OTA writes; record it, and stop to review bootloader, abl or modem rows
unzip -p "$TF" SYSTEM/build.prop | grep -E '^ro\.system\.build\.fingerprint='
unzip -p "$TF" SYSTEM/build.prop VENDOR/build.prop '*/etc/build.prop' | grep -E '^ro\.([a-z_]+\.)?build\.date\.utc='
unzip -p "$TF" SYSTEM/etc/security/otacerts.zip > tf-otacerts.zip
diff <(unzip -p tf-otacerts.zip | openssl x509 -noout -fingerprint -sha256) \
     <(unzip -p /abs/device-otacerts.zip | openssl x509 -noout -fingerprint -sha256)
unzip -l "$TF" | grep -E 'SYSTEM_EXT/priv-app/ElizaOsUpdater/|SYSTEM_EXT/etc/(permissions/ElizaOsUpdater|default-permissions/default-permissions-ai.elizaos.updater|sysconfig/ElizaOsUpdater-sysconfig)'
unzip -p "$TF" SYSTEM_EXT/etc/selinux/system_ext_sepolicy.cil | grep update_engine_service | grep -v neverallow   # eliza_updater beside stock factory_ota_app and rilextensionservice_app, never priv_app; confirm this path on the first target-files
unzip -p "$TF" SYSTEM_EXT/etc/selinux/system_ext_seapp_contexts | grep ai.elizaos.updater   # domain=eliza_updater
unzip -p "$TF" SYSTEM_EXT/etc/selinux/system_ext_mac_permissions.xml \
  | grep -o 'signature="[0-9a-f]*"><seinfo value="eliza_updater"' \
  | sed 's/.*signature="\([0-9a-f]*\)".*/\1/' | xxd -r -p | sha256sum   # the updater signer's digest below
unzip -p "$TF" SYSTEM_EXT/priv-app/ElizaOsUpdater/ElizaOsUpdater.apk > /abs/image-updater.apk
apksigner verify --print-certs /abs/image-updater.apk    # SDK build-tools or $ANDROID_HOST_OUT/bin
aapt2 dump strings /abs/image-updater.apk | grep -F "${CHANNEL_KEY:?}"
aapt2 dump strings /abs/image-updater.apk | grep -F "${CHANNEL_MANIFEST_URL:?}"
unzip -p "$TF" PRODUCT/app/AlphaPhone/AlphaPhone.apk > /abs/image-alpha.apk
apksigner verify --print-certs /abs/image-alpha.apk      # SDK build-tools or $ANDROID_HOST_OUT/bin
apksigner verify --print-certs /abs/installed-alpha.apk  # same certificate SHA-256 digest required
```

Stop unless: the updater's APK, allowlist, default-permissions and sysconfig files are all listed;
the compiled system_ext policy gives `update_engine_service` to `eliza_updater` beside the stock
`factory_ota_app` and `rilextensionservice_app` rows, and to no `priv_app` domain; `system_ext_seapp_contexts` maps `ai.elizaos.updater` to `eliza_updater`; the certificate
digest in `system_ext_mac_permissions.xml` equals the updater APK's signer digest, because a mismatch
leaves the updater in `priv_app` with no `update_engine`;
the updater APK holds this `CHANNEL_KEY` and `CHANNEL_MANIFEST_URL`; `ab_update=true` and `virtual_ab=true`; the fingerprint carries this build's `BUILD_NUMBER`; every `ro.<partition>.build.date.utc` (system,
vendor, product, system_ext, odm, where present) is **greater** than the device's, because
`update_engine` checks each partition (the 2026-10-24 evidence records an incremental build that kept an earlier timestamp; then
rebuild so the build properties regenerate, never `--downgrade`); the target's `otacerts.zip`
holds the device's certificate (the running build verifies the payload against it); both APKs have the same signer digest. With a higher versionCode in the image the system
copy replaces the installed update, otherwise the installed update stays; data is kept either way
because the signer is the same.

### 4. Generate the full OTA and its manifest, then prove the channel (on the builder)

`OTA_DIR` is a scratch directory on the builder; never reuse AOSP's `OUT_DIR` name, which a later `m`
in the same shell would build into.

```sh
OTA_DIR=/abs/ota-lab-$(date -u +%Y%m%dT%H%MZ); mkdir "$OTA_DIR"
bash "$ALPHA/scripts/ota/generate-ota.sh" --releasetools "$ANDROID_HOST_OUT/bin" \
  --package-key "$AOSP_SOURCE/build/make/target/product/security/testkey" \
  --target-files "$TF" --out "$OTA_DIR/ota.zip"
node "$ELIZA/packages/os/scripts/android/channel-manifest.mjs" --channel beta --version "lab-$(date -u +%Y%m%d)" --sequence 1 \
  --base-url http://127.0.0.1:8000/ --out "$OTA_DIR/manifest.json" "$OTA_DIR/ota.zip"
```

Check `buildFingerprint` (test-keys, stallion) and `buildDateUtc` (greater than the device's) in
`manifest.json`.

Prove the channel key and URL now, while the phone is untouched. After step 7 the old slot is gone
and a wrong value needs a second full build and cable OTA. Make a manifest that offers nothing. At
rollout 0 nothing reads its URL:

```sh
node "$ELIZA/packages/os/scripts/android/channel-manifest.mjs" --channel beta --version "lab-$(date -u +%Y%m%d)" \
  --sequence 1 --rollout-percent 0 --base-url https://updates.example/unused/ \
  --out "$OTA_DIR/stallion-beta.json" "$OTA_DIR/ota.zip"
```

On the offline host, sign the exact bytes and verify before upload (OpenSSL 3):

```sh
openssl pkeyutl -sign -rawin -inkey channel-lab.pem -in stallion-beta.json -out stallion-beta.json.sig
openssl pkey -in channel-lab.pem -pubout -out channel-lab.pub
openssl pkeyutl -verify -rawin -pubin -inkey channel-lab.pub -in stallion-beta.json -sigfile stallion-beta.json.sig
```

Publish `stallion-beta.json` and its `.sig` at `$CHANNEL_MANIFEST_URL`. On a GitHub release keep it a
**prerelease** with a fixed tag, created once:

```sh
gh release create os-channel --prerelease --repo eliza-research/alphaphone --title os-channel --notes ''
gh release upload os-channel stallion-beta.json stallion-beta.json.sig --clobber --repo eliza-research/alphaphone
```

Back on the builder (OpenSSL 3), read both through the baked URL and verify them with the baked key:

```sh
curl -fsSL "$CHANNEL_MANIFEST_URL" -o "$OTA_DIR/m.json"
curl -fsSL "$CHANNEL_MANIFEST_URL.sig" -o "$OTA_DIR/m.sig"
printf %s "$CHANNEL_KEY" | base64 -d | openssl pkey -pubin -inform DER -out "$OTA_DIR/p.pub"
openssl pkeyutl -verify -rawin -pubin -inkey "$OTA_DIR/p.pub" -in "$OTA_DIR/m.json" -sigfile "$OTA_DIR/m.sig"
```

Stop before step 5 unless both downloads succeed and this prints `Signature Verified Successfully`.
Step 3 already tied these two values to the image. A wrong value means correcting it in
`vendor/alphaphone/updater/res/values/channel.xml` and repeating steps 2 to 4; never re-run 2a, which
would nest the module and double the make lines.

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
M="$OTA_DIR/manifest.json"
URL=$(node -p "require('$M').updates[0].url")
OFFSET=$(node -p "require('$M').updates[0].payload.offset")
SIZE=$(node -p "require('$M').updates[0].payload.size")
HEADERS=$(node -p "require('$M').updates[0].payload.properties.join('\n')")
adb -s "$SERIAL" shell "su 0 update_engine_client --update --follow --payload=$URL --offset=$OFFSET --size=$SIZE --headers='$HEADERS'"
```

`su 0` is how `update_device.py` starts the client on userdebug: stock policy gives shell no binder
call with `update_engine`. Never `adb root` here: restarting adbd drops the `adb reverse` rule from
step 5.

Expect progress, then `UPDATE_STATUS_UPDATED_NEED_REBOOT` and exit 0. Virtual A/B writes the
inactive slot through snapshots, whose copy-on-write may use space on `/data`; the running slot and
user data are not modified. Watch
`adb -s "$SERIAL" logcat -s update_engine` in another terminal. Before rebooting,
`ro.boot.slot_suffix` is still the old slot. Then `adb -s "$SERIAL" reboot`. If the phone is ringing or
in a call, wait.

### 7. Verify the slot switch

If this wait has not returned 10 minutes after the reboot, stop it and go to step 8.

```sh
adb -s "$SERIAL" wait-for-device
adb -s "$SERIAL" shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 2; done'
adb -s "$SERIAL" shell getprop ro.boot.slot_suffix        # the other slot
adb -s "$SERIAL" shell getprop ro.build.date.utc          # = manifest buildDateUtc
adb -s "$SERIAL" shell getprop ro.build.fingerprint       # = manifest buildFingerprint
adb -s "$SERIAL" shell getenforce                         # Enforcing
adb -s "$SERIAL" shell getprop ro.boot.verifiedbootstate  # orange, as before (unlocked)
adb -s "$SERIAL" shell dumpsys package ai.elizaresearch.alphaphone | grep -E 'versionCode|codePath'
adb -s "$SERIAL" shell su 0 update_engine_client --merge  # returns when the Virtual A/B merge is done
echo "merge exit $?"                                      # 0
```

The owner unlocks the phone once now. `BOOT_COMPLETED` comes after the first unlock and only that
schedules the updater's job, so before it the job checks below find nothing.

```sh
adb -s "$SERIAL" shell getprop ro.control_privapp_permissions
adb -s "$SERIAL" shell pm path ai.elizaos.updater         # /system_ext/priv-app/ElizaOsUpdater/...
adb -s "$SERIAL" shell dumpsys package ai.elizaos.updater | grep -E 'android.permission.(REBOOT|READ_PHONE_STATE|POST_NOTIFICATIONS): granted=true'
adb -s "$SERIAL" shell dumpsys jobscheduler | grep -A3 ai.elizaos.updater
adb -s "$SERIAL" shell ls /system/etc/security/cacerts | wc -l
```

Prove the channel on the phone while the cable is still attached, because a failure after this shows
nothing. The updater reads the rollout 0 manifest published in step 4. It runs only inside its job,
so read its domain while it runs. This is the one step here that starts something, a single check
that reaches the channel; at rollout 0 it applies nothing:

```sh
adb -s "$SERIAL" shell cmd jobscheduler run -f ai.elizaos.updater 1
adb -s "$SERIAL" shell ps -AZ | grep ai.elizaos.updater   # u:r:eliza_updater:..., never priv_app or priv_app_36
sleep 20                                                  # the check reaches the channel
adb -s "$SERIAL" logcat -d | grep -E 'avc: denied.*(update_engine|eliza_updater)|ElizaOsUpdater'   # no denial, no "Update run ended early"
adb -s "$SERIAL" shell su 0 content call --uri content://ai.elizaos.updater.status --method status   # state=up-to-date
adb -s "$SERIAL" exec-out su 0 cat /sys/fs/selinux/policy > /abs/device-policy
m sepolicy-analyze   # in "$AOSP_SOURCE"; no output and exit 0 means no app domain outside this list reaches update_engine
"$ANDROID_HOST_OUT/bin/sepolicy-analyze" /abs/device-policy neverallow -n 'neverallow { appdomain -eliza_updater -rilextensionservice_app -system_app -gmscore_app -factory_ota_app } update_engine:binder call;'
```

Pass: the other slot, the new date and fingerprint, Alpha is HOME with the owner still signed in and
their data present, `--merge` exited 0, the three updater permissions granted, a `cacerts` count above
0, `eliza_updater`, no `update_engine` or `eliza_updater` denial, no `Update run ended early`,
`state=up-to-date`, and `sepolicy-analyze` silent with exit 0. Its list is `eliza_updater` and the four
stock app domains that hold `update_engine:binder call` in the CP3A stallion policy; any other holder,
`priv_app` included, prints a line and exits non-zero. The stock four keep their access (Open point 9). After
`--merge`, that state proves the signature, the embedded key, TLS on the job's network and the JSON
parsing on the phone; during a merge the job writes it without reading the channel. Anything else
means the key, the URL or the policy is wrong, and only another cable OTA corrects them, so fix it
before the cable comes off.

The payload path stays unproven until step 9. Rollout 0 returns before `applyPayload` from `eliza_updater`,
`NETWORK_ID` and `update_engine`'s own HTTPS fetch, which reads `/system/etc/security/cacerts` itself
and is separate from the TLS the job proves. Keep the cable available for the first remote update.

A failed updater never blocks the demo: it does nothing and says nothing. A missing privapp allowlist
entry is different: under `enforce` it stops `system_server`, the new slot never completes boot and
the way back is step 8.

### 8. Rollback

- **Before the reboot** (`UPDATED_NEED_REBOOT`): `adb -s "$SERIAL" shell su 0 update_engine_client --reset_status`
  cancels the slot switch; after a reboot the device runs the same slot and build. This is the only
  rollback to run on purpose tonight.
- **The new slot does not boot** (no lock screen 10 minutes after the reboot): it may be in a framework
  restart loop, which restarts `zygote`, not the kernel, so waiting does not help. `init` reboots for
  `zygote` only under step 1's property, and RescueParty is off on userdebug, so nothing prompts a
  wipe. Run plain `adb -s "$SERIAL" reboot`, or hold the power button if adb does not answer, wait
  10 minutes, and repeat until the old slot boots. Each real reboot uses one bootloader try. The new
  slot was never marked successful, so the bootloader returns to the previous slot, which stays
  intact until boot completes. gs-common's boot HAL arms three tries; this unit's bootloader is
  unverified. Still no fastboot. Verify with step 7 that the slot and date are the old ones.
- **After the new slot booted and merged**, the previous slot's contents are gone (Virtual A/B).
  Rollback is a roll forward: rebuild the previous source (it gets a newer date) and repeat steps 2
  to 7.

### 9. The first remote update (test keys, cable within reach)

This is the first run of the payload path (step 7), so keep the cable available until it passes. The
owner or Root decides the payload host first (section 2.4). Build as steps 2 and 3 with a new
`BUILD_NUMBER`; the build date must be newer than the unit's.

```sh
OTA_DIR=/abs/ota-lab-$(date -u +%Y%m%dT%H%MZ); mkdir "$OTA_DIR"
bash "$ALPHA/scripts/ota/generate-ota.sh" --releasetools "$ANDROID_HOST_OUT/bin" \
  --package-key "$AOSP_SOURCE/build/make/target/product/security/testkey" \
  --target-files "$TF" --out "$OTA_DIR/ota.zip"
sha256sum "$OTA_DIR/ota.zip"; du -h "$OTA_DIR/ota.zip"    # over 2 GiB rules out a GitHub release asset
node "$ELIZA/packages/os/scripts/android/channel-manifest.mjs" --channel beta --version "lab-$(date -u +%Y%m%d)" \
  --sequence <last beta sequence + 1> --base-url "https://<payload host>/stallion/lab-<date>/" \
  --out "$OTA_DIR/stallion-beta.json" "$OTA_DIR/ota.zip"
```

Upload `ota.zip` first and confirm a Range request returns 206. Then sign, verify and publish
`stallion-beta.json` as in step 4; the `os-channel` release exists, so only `gh release upload` runs
again.

The two files do not change atomically; a device that fetches between them refuses quietly and
retries. The unit starts the update on its next check (every 6 h on unmetered Wi-Fi with the battery
not low). To check now: `adb shell cmd jobscheduler run -f ai.elizaos.updater 1`. The job then stays
open while `update_engine` works, so **Update ready** posts when the work ends, if that is inside a
job run; otherwise the run after it posts it. The owner sees one silent notification and taps
**Restart**; during a call in any state, ringing on a silenced phone included, that tap does nothing
and the notification stays. Verify with step 7. A later run sees the new build and reports up to
date.

On this first remote update, measure one transfer with the screen off and on battery: time from
start to **Update ready**, and `update_engine` progress in logcat across a gap between job runs
(section 2.5, step 3). If it stalls, the fix is a partial wake lock in a later OTA; this client can
still install that OTA, more slowly.

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
  release becomes `releases/latest`. The automatic app updater does not follow `releases/latest`:
  it reads an asset of the fixed `app-stable` release
  (`releases/download/app-stable/alpha-update-stable.json`, `app.config.json:8` at Alpha
  `0ead71fc54`, same at `8c30b83c51`). Any manual or older consumer of `releases/latest` was
  not audited, so OS assets must stay off `latest`. Assets answer 302 then 206 with
  `Accept-Ranges: bytes`. GitHub limits an asset to 2 GiB; tonight's images zip is 1.7 GB compressed
  and 3.4 GB raw, so measure `ota.zip`. Above the limit the fastest viable payload host is a GCS
  bucket in the Alpha GCP project where the builder runs (`gcloud storage cp`, Range support, objects
  to 5 TiB, read-only object grant without listing); Cloudflare R2 is the alternative. Publicly
  hosting an OTA that contains Pixel vendor and firmware blobs is a separate owner decision.
- `update_engine` verifies the payload signature against the running build's `otacerts.zip` and,
  at the end of the download, the `FILE_HASH` header, before postinstall and any slot switch, so the
  CDN is never trusted with content. `METADATA_HASH` only forms the payload id on this path. On a
  test-key unit the signed channel's `FILE_HASH` is the only real boundary, because the test key is
  public. The updater keeps
  the highest `sequence` it has accepted per channel and refuses a lower one, so a replayed earlier
  manifest cannot lift a halt this device has already read. A device that never fetched the halt still
  accepts the earlier manifest, so a CDN that withholds the halt can serve the withdrawn release (open
  point 5). `FILE_HASH` still binds the bytes to a signed release, and `buildDateUtc` must be newer
  than the booted build, so a replay never installs an older one.

### 2.5 The privileged update client

`packages/os/android/updater` upstream: OS behaviour every A/B elizaOS image needs. Alpha supplies only
product values, so its module budget is untouched. Unlike the listener there is no Alpha `android/`
module.

| Property | Decision |
| --- | --- |
| Package | `ai.elizaos.updater`, a separate small app, never part of `:app`. The Alpha app stays nonprivileged (P-75). |
| Build | Soong `android_app` from source in the image build, `sdk_version: system_current`, because `UpdateEngine` is `@SystemApi`. `certificate: "testkey"` signs it, the same certificate the policy's `keys.conf` names; release signing moves both to `releasekey` (Open point 7). |
| Partition | `/system_ext/priv-app/ElizaOsUpdater`, installed for the system user only. This is the image's second privileged package, after the listener. |
| Privileged permissions | `REBOOT` only (`privapp_allowlist`). |
| Other permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, and the runtime permissions `POST_NOTIFICATIONS` and `READ_PHONE_STATE`. `DefaultPermissionGrantPolicy` grants those two from `/system_ext/etc/default-permissions` (`fixed="false"`) when the fingerprint changes, so nothing prompts; the app has no screen to prompt from. It has no launcher entry, so permission hibernation exempts it. If the owner revokes `READ_PHONE_STATE` in Settings, **Restart** does nothing until it is granted again. |
| Never | `READ_PRIVILEGED_PHONE_STATE` (it also exposes persistent device identifiers, which this client never reads), `RECOVERY`, `ACCESS_CACHE_FILESYSTEM` or `/data/ota_package` (the payload streams by URL), `INSTALL_PACKAGES`, `WRITE_SECURE_SETTINGS`. |
| SELinux | `update_engine` checks no caller itself and stock `priv_app` cannot reach it, so the updater has its own domain, `eliza_updater`, in system_ext private policy. It is `app_domain`, `net_domain` and `app_api_service`, the shape of stock `adservices`, plus `update_engine_service` and Binder both ways; it inherits none of `priv_app_all`. `mac_permissions.xml` gives the seinfo to its signer, and `seapp_contexts` maps name, seinfo and `isPrivApp` to the domain, ahead of every target-SDK row, so another package under that signer carries an unused seinfo. Two `neverallow priv_app_all` rules run in `sepolicy_neverallows` at every image build, so the generic grant cannot return. Four stock app domains outside `priv_app_all` keep their own paths (Open point 9). |
| Platform API | `android.os.UpdateEngine`: `bind`, `applyPayload(url, offset, size, headers)`, `unbind`. `TelecomManager.isInCall`, `AppOpsManager.checkOpNoThrow`. |
| Status | `content://ai.elizaos.updater.status`, `call("status")`, guarded by `ai.elizaos.updater.permission.READ_STATUS` (`signature\|knownSigner`, bound to the launcher certificate) and re-checked in `call()`. |

Behaviour:

1. **Check**: one persisted periodic job, scheduled at `BOOT_COMPLETED`: unmetered network, battery
   not low, every 6 h with 2 h flex, linear backoff of 15 min. Each run binds `UpdateEngine`, which
   reports its status at once.
2. **Manifest** (idle only): fetch at most 64 KiB and `<url>.sig` on the job's network. Verify the
   Ed25519 signature over the exact bytes before parsing, against the key in this image. Accept only
   schema 1, this channel, `Build.DEVICE`, a `sequence` at or above the highest accepted and a
   `rolloutPercent` from 0 to 100. The sequence is on disk (`commit`, checked) before anything acts on
   the manifest, even when halted, so a halt read once outlives a power cut. Then offer only inside the rollout bucket, with `buildDateUtc`
   newer than `ro.build.date.utc`, and with the same brand, product, device, type and tags as the
   booted fingerprint, so test-keys goes only to test-keys. Pick the incremental whose `from` is
   `Build.FINGERPRINT`, otherwise the full package; its URL must be https, its offset and size in
   range and `FILE_SIZE` equal to its size.
3. **Download**: `applyPayload` with exactly `FILE_HASH`, `FILE_SIZE`, `METADATA_HASH` and
   `METADATA_SIZE` and the client's own `NETWORK_ID`, which keeps the transfer off cellular. Nothing
   else passes, because `update_engine` would obey `POWERWASH`, `SPL_DOWNGRADE` and other headers.
   A job stopped during the channel check never calls `applyPayload`; its next run does.
   `update_engine` takes no wake lock, so the job stays open until `onPayloadApplicationComplete`
   or `onStopJob`, and JobScheduler's wake lock keeps the CPU up. A job run lasts 10 to 30 min
   (10 after three timeouts in 24 h); then a gap of 15 min times the attempts, to 5 h at most, has no
   wake lock, and with the screen off `update_engine` can freeze until the next run. Nothing is lost
   in a gap. A transfer lost to the network or a reboot resumes when a later run calls `applyPayload`
   with the same hashes; `update_engine` reports `NOT_ENOUGH_SPACE` itself, so there is no
   `allocateSpace`. The updater has no launcher activity, so Android keeps it in the active standby
   bucket and repeated timeouts cannot restrict it.
4. **Ready**: on `UPDATED_NEED_REBOOT`, one silent "Update ready" notification with a **Restart**
   action. There is no automatic or overnight restart yet.
5. **Never during a call**: `TelecomManager.isInCall()` and the audio mode are read immediately
   before rebooting. Only no call in any state and `MODE_NORMAL` restart; anything else does nothing
   and leaves the notification. `isInCall` is required because Telecom sets `MODE_RINGTONE` only when
   the ringer takes audio focus, so a call ringing on a silenced phone stays in `MODE_NORMAL`. The
   audio mode covers communication sessions Telecom does not know. An unknown call state never
   restarts: with `READ_PHONE_STATE` alone `isInCall` throws when the permission is revoked and reads
   false when its app-op is refused, so the permission and the app-op are checked first, and a missing
   `TelecomManager` stops here too. `isInCall` also reads false on a Binder failure, which no public
   API tells apart; Telecom runs inside `system_server`, whose death ends this process as well.
6. **No error text**: no failure toast, dialog or notification anywhere. A failed run ends quietly
   and the next one retries. Status is state only: up-to-date, downloading or ready, and the booted
   build's version.
   A later APK update can show it in Settings > About through a shared upstream plugin, not a new
   Alpha plugin.
7. **After restart** the client does nothing: `update_engine` schedules the Virtual A/B merge
   itself. A run during the merge reports up-to-date and asks its backoff for another look, and a
   later run reads the channel.

An unattended restart leaves the phone locked before its first unlock, when apps that are not
direct-boot aware (Alpha's agent, reminders) cannot run. Resume on Reboot
(`RecoverySystem.prepareForUnattendedUpdate`, `rebootAndApply`) avoids that only where a
reboot-escrow provider exists, which must be verified on stallion without Google services. Until it
is, the "Update ready" notification is the only restart path.

Deferred until after the demo: a kill switch that acts on work already
started; skipping a payload that failed permanently (today each failure retries on the 15-minute
linear backoff, to 5 h at most, until a run finishes without rescheduling);
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
outside the rollout bucket doing nothing, no restart during a ringing or active call (with the
ringer on and on a silenced phone), and a lost
Wi-Fi network ending the transfer until a later run resumes it, never on cellular. Evidence, the
`signedUpdateRecovery` gate and the channel's `drills` are recorded as #673 describes.

## Open points

1. Unverified on stallion: that the target-files carries `SYSTEM/etc/security/otacerts.zip` with the
   test key's certificate (generate-ota.sh refuses otherwise). The whole updater is unverified on a
   device: Soong build, policy, grants, `update_engine` calls, the notification and how far a
   screen-off transfer gets between job runs (step 9). The `eliza_updater` policy has passed
   `checkpolicy`, `checkseapp` and `insertkeys` on a host against the android-17.0.0_r1 platform
   policy, and its rules compile with neverallows on against the stock CP3A stallion CIL set, not the
   generated tree.
2. A build whose date is not newer than the device's is refused by `update_engine`; the fix is a
   rebuild, never `--downgrade`.
3. generate-ota.sh signs incrementals with key files only; managed signing needs a payload signer
   option there when the HSM path is chosen. Moving it upstream next to `channel-manifest.mjs` is
   deferred.
4. `pixel10a-alpha.json` gets its `updater` block (`channel`, `manifestUrl`, `channelKey`) once the
   host and lab key exist; a composed build stages no updater before that.
5. Manifests carry a `sequence` but no expiry. A replay of the current manifest can withhold a newer
   one, and a device that never read a halt still accepts an earlier manifest, so a CDN that withholds
   the halt can serve the withdrawn release. An enforced `expiresAt` needs scheduled re-signing and
   a trusted clock. Every signed change takes a new sequence: the client does not bind a sequence to
   the first manifest's bytes.
6. Resume on Reboot needs stallion verification before overnight restarts.
7. `sign_target_files_apks` rewrites `*mac_permissions.xml` from dev certificates it reads relative to
   its working directory and skips a missing one silently. Release signing runs it from the otatools
   root and refuses, before any OTA, a `*mac_permissions.xml` that still holds an AOSP dev certificate.
   Confirm on the first run that otatools carries them at `build/make/target/product/security`, and
   repeat the step 3 digest check on the signed target-files: a `--map-key` source is not pinned, and
   a skipped rewrite leaves the updater out of its domain, with no `update_engine`.
8. Whether the APK lane's `alpha-update/v1` duplicates upstream's plugin-native-agent updater and
   ota-trust APK descriptors is a separate owner decision. The APK lane cannot share a fetch helper
   with this client: it runs in Alpha's process, built by Gradle, and this is a separate Soong app.
9. Four stock app domains besides the updater reach `update_engine` in the CP3A stallion policy:
   `rilextensionservice_app`, `system_app`, `gmscore_app` and `factory_ota_app`. The first binds
   `com.google.android.rilextension` by name and `isPrivApp` with no seinfo, and the source lock lists
   `system_ext/priv-app/ril-extension/ril-extension.apk`. Owner decision: accept that stock path, or
   strip its rules from the extracted `sepolicy_ext.cil` through the existing vendor patch.
