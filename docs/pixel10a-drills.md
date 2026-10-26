# Pixel 10a flashing and update/recovery drills

Issues [#377](https://github.com/AlphaCompute/alphaphone/issues/377) and
[#400](https://github.com/AlphaCompute/alphaphone/issues/400). Two scripts run against one
physical Pixel 10a (stallion) addressed by its USB serial. Network adb serials such as a
Cuttlefish `127.0.0.1:6520` are refused. Each script hashes its inputs and checks the device
before it changes anything. It writes its records into a new `--out` directory, never over an
existing one, and each record lists every adb/fastboot command that ran. None of this has
run against a device yet. The tests (`node --test test/pixel10a-flash.test.mjs
test/pixel10a-drills.test.mjs`) use a scripted fake adb/fastboot. They show refusals, command
lines and record contents. They are not a flash, an applied OTA or a drill.

## Flashing

```sh
node scripts/pixel10a-flash.mjs --serial SERIAL --image-zip /abs/alpha-stallion-img.zip \
  --image-sha256 HEX --out /abs/new-flash-dir [--wipe] [--fastboot PATH] [--adb PATH] [--apksigner PATH]
```

The zip must match `--image-sha256`, and its `android-info.txt` must require board `stallion`.
`fastboot getvar` must report product `stallion`, `unlocked: yes`, and the bootloader and
baseband versions the image requires. If the zip's `fastboot-info.txt` erases userdata or
metadata unconditionally, the script refuses unless `--wipe` is given; `-w` is passed only with
`--wipe`. It runs `fastboot -s SERIAL [-w] --skip-reboot update ZIP` and `fastboot reboot`, then
waits for `sys.boot_completed`. It writes `flash-start.json`, `flash-result.json` and
`postboot.json`. These hold the fingerprint, `ro.boot.vbmeta.digest`, verified boot state,
SELinux mode, HOME role holder, and the Alpha package's version and pulled APK hash (plus
signer with `--apksigner`).

```sh
node scripts/pixel10a-flash.mjs --serial SERIAL --enroll-avb-key /abs/avb_pkmd.bin --avb-key-sha256 HEX --out /abs/new-dir
node scripts/pixel10a-flash.mjs --serial SERIAL --lock --confirm-destructive --out /abs/new-dir
```

Enrollment runs `fastboot erase avb_custom_key` and `fastboot flash avb_custom_key`. Once
`avb.publicKeySha256` in `android/aosp/pixel10a-product.json` is reviewed, the key must match it.
`--lock` refuses unless Android is booted on a `user/release-keys` build and
`fastboot flashing get_unlock_ability` is 1. Then it runs `fastboot flashing lock` and expects
`yellow` verified boot afterwards.

## Drills

Every drill starts from booted Android with adb authorized. The OTA is the signed package from
`scripts/sign-aosp-release.mjs` (see [Pixel 10a staging](pixel10a-staging.md)).

```sh
node scripts/pixel10a-drills.mjs signed-update --serial SERIAL --ota /abs/ota.zip --ota-sha256 HEX \
  --out /abs/new-dir [--method sideload|update-engine] [--confirm-destructive]
node scripts/pixel10a-drills.mjs interrupted-update --serial SERIAL --ota /abs/ota.zip --ota-sha256 HEX \
  --out /abs/new-dir [--method sideload|update-engine] [--interrupt reboot|kill] [--interrupt-after-seconds 30]
node scripts/pixel10a-drills.mjs compatible-rollback --serial SERIAL --ota /abs/candidate-ota.zip --ota-sha256 HEX \
  --known-good-record /abs/known-good/release-record.json --out /abs/new-dir [--method sideload|update-engine]
node scripts/pixel10a-drills.mjs stock-recovery --serial SERIAL \
  --factory-zip /abs/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --alpha-image-zip /abs/alpha-stallion-img.zip --alpha-image-sha256 HEX --out /abs/new-dir --confirm-destructive
```

- **Apply mechanisms.** `sideload` (the default) runs `adb reboot sideload[-auto-reboot]` and
  `adb sideload`. The device's own recovery checks the package against its installed otacerts and
  refuses an older build. This is the path a locked user release-keys build supports.
  `update-engine` extracts `payload.bin`, pushes it to `/data/ota_package` and runs
  `update_engine_client --update --follow` with the `payload_properties.txt` headers. It needs
  `adb root`, so it works only on userdebug builds. Before any device change, the script refuses
  an OTA that is not A/B for `stallion`, a downgrade package, an incremental OTA whose
  `pre-build` is not the running build, and an OTA that is not newer than the running build. An
  `ota-wipe` package needs `--confirm-destructive`.
- **signed-update** passes only when, after the update, the other slot boots the OTA's
  `post-build` fingerprint, and boots it again after a second reboot.
- **interrupted-update** stops the apply after `--interrupt-after-seconds`, either by rebooting
  (`reboot`) or by killing `update_engine` (`kill`, which needs `--method update-engine`). The old
  slot must still boot the old fingerprint. The update is then applied again, and the new slot
  must boot the new fingerprint. If the first apply finished before the interruption, the drill
  fails.
- **compatible-rollback** uses a pre-merge slot revert. The device must already run the
  known-good build recorded in `--known-good-record` (a `release-record.json`). The script
  applies the candidate OTA and never boots it. From the bootloader it checks that the candidate
  staged the other slot, runs `fastboot --set-active=<known-good slot>` and boots. The known-good
  fingerprint and slot must come up, and survive a second reboot. Virtual A/B then cancels the
  unmerged snapshot. The channel's `downgradeAllowed: false` rules out a downgrade OTA. After a
  Virtual A/B merge the old slot no longer exists, so returning to a known-good build after a
  merge means a new, higher-versioned release (a roll forward). That is not this drill.
- **stock-recovery** first checks that the factory archive has the channel's
  `recovery.stockFactoryImage` filename and SHA-256. It extracts the bootloader, radio and image.
  It flashes the bootloader and radio only when they differ from the device. Then it runs
  `fastboot -w --skip-reboot update` with the stock image. The stock boot must report
  `google/stallion/stallion:` with the archive's build ID and `release-keys`. It then reflashes
  the Alpha image with `-w` and checks that `alpha_stallion_phone` boots. The extracted images
  are deleted afterwards.

Each drill writes `<drill>.json` with `executed`, `passed`, serial, fingerprints and slots
(before, after, and any interrupted, staged or stock state), and every failed check.

## Recording and the channel

```sh
node scripts/pixel10a-drills.mjs record --result /abs/a/signedUpdate.json --result /abs/b/interruptedUpdate.json \
  --result /abs/c/compatibleRollback.json --result /abs/d/stockRecovery.json --out /abs/new-drill-evidence.json
node scripts/pixel10a-drills.mjs --apply-to-channel /abs/new-drill-evidence.json
```

`record` writes new evidence JSON and lists every reason the evidence cannot yet be applied. It
never edits `android/aosp/pixel10a-ota-channel.json`. `--apply-to-channel` is the only command
that changes the channel's `drills` and `recovery.knownGoodRelease`, and it adds a
`drillEvidence` reference. It refuses unless all of the following hold:

- All four drills are present, with `executed: true`, `passed: true` and no recorded problems.
- They ran on one serial, with before and after fingerprints and slots.
- Every Alpha build in them is a `user/release-keys` build.
- The drill-specific checks hold: the slot changes, the old build boots after the interruption,
  the device returns to the known-good build, and the device boots stock from the channel's
  archive.
- The channel's `otaCertificateSha256` and `avbPublicKeySha256` are reviewed and the same as
  those recorded in the evidence. While they are `UNSET`, no evidence can be applied.

## What needs a person

- **Unlocking.** OEM unlocking in Settings, then `fastboot flashing unlock` confirmed on the
  device. This wipes the device. The scripts refuse a locked bootloader for flashing and stock
  recovery.
- **Locking.** The person confirms `fastboot flashing lock` on the device. This also wipes it.
- **USB debugging after a wipe.** Stock Android, and a user build, come up after a wipe with USB
  debugging off. To record the boot, the person finishes setup, enables Developer options and USB
  debugging, and authorizes the computer. The drill waits up to an hour.
- **Recovery menus.** If recovery on a user build rejects `adb reboot` after a sideload, the
  person chooses "Reboot system now" (interrupted-update) or "Reboot to bootloader"
  (compatible-rollback) on the device.
- **Locked rollback.** Whether a locked stallion bootloader accepts `fastboot --set-active` is
  not established. If it does not, the drill records the failure.
