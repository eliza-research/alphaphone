# Pixel 10a Android 17 source contract

Issues #399 and #377 select Pixel 10a, codename `stallion`, on Android 17.
The connected development device's hardware SKU is `GE1GQ`. Pixel 10 and Pixel 11
are different targets; their placeholders and configurations cannot admit this device.

`android/aosp/pixel10a-source.json` records the inspected development source inputs:

- AOSP `android-17.0.0_r1`, manifest commit `5bc9a7ce1cd78dd53613bbfd0ebf506e1e4adb0f`.
- 1,084 platform project revisions plus three pinned device extraction projects.
- Factory `stallion-cp3a.261005.005-factory-d1d25502.zip`, SHA-256
  `d1d2550268de9fd4bfdd4ff0910cc4471fec6ba361506278c25f34f312106675`.
- 6,360 generated vendor files, including stock kernel/modules, firmware and device
  configuration. Only paths, lengths and hashes are committed; no licensed binaries.
- Sixteen exact source overrides: fourteen attributed extraction-tool overlays,
  the vendor `AID_AOAD` compatibility ID, and extracted SELinux CIL integration.
  The original patches are retained with the stallion product work. Neverallow
  checks remain enabled; a source match does not prove policy runtime behavior.

The source input provenance is the separate Eliza development commit
`74504c953b`, fully identified in the lock. This is not a change to the current
`vendor/eliza` app/runtime pin. GrapheneOS supplies attributed extraction-tool and
compatibility references; the platform baseline is AOSP.

Run against an already prepared source checkout and retained factory archive:

```sh
node scripts/verify-pixel10a-source.mjs \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --out /absolute/new-source-check.json
```

The command reads files and Git state. It checks every listed project revision,
rejects additional tracked/untracked source changes and hidden index flags, compares
all reviewed overrides and the complete generated vendor inventory, and hashes the
factory archive. It writes only the explicitly requested new report. It neither
prepares nor patches a source tree. Ignored build outputs and the separately staged
`vendor/alphaphone` app payload are not covered by this source-input check; APK,
secure camera and listener admission still apply independently during staging.

On October 15 the actual prepared source passed all 1,087 revision checks, 16 override
checks, 6,360 generated-file checks and the factory hash. This establishes the
recorded development inputs, not a clean build from them or acceptance of current main.
The historical October 11 physical image used the older Eliza `91dc1919` app pin.
Read-only October 15 observation found Android 17 booted with enforcing SELinux and
Alpha HOME on the physical Pixel, but with an app override under `/data/app`.
Cuttlefish at the separately inspected target had Alpha under `/product/app` and
Alpha HOME. Neither observation qualifies the current app/runtime pin or signed updates.

Remaining work includes integrating these inputs with the current admitted APK and
listener, rebuilding/booting exact images, native runtime and speech execution,
physical hardware/user tests, managed release signing, signed update/interruption,
and compatible recovery drills. Release qualification is explicitly false in both
the lock and every verifier result. Keep #377, #399 and #400 open until their full
acceptance criteria are supported by the appropriate evidence.
