# Pixel 10a image build and release pipeline

Two in-repo scripts replace the ad-hoc image-host scripts for `alpha_stallion_phone`
(issues #399, #400, #377). A self-hosted Linux runner with the prepared stallion source
tree and the pinned factory archive runs them. Staging the overlay into the tree is a
separate step, described in [Pixel 10a staging and release signing](pixel10a-staging.md).

## Image build

```sh
node scripts/aosp-build-image.mjs \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip \
  --variant development|production --out /absolute/new-build-dir \
  [--jobs N] [--min-free-gib 12] [--out-dir out] [--gomaxprocs 2] [--gomemlimit 18GiB] \
  [--ninja-highmem-jobs 1] [--dry-run]
```

`--variant` selects `lunch.development` (`alpha_stallion_phone-cp2a-userdebug`) or
`lunch.production` (`alpha_stallion_phone-cp2a-user`) from
`android/aosp/pixel10a-product.json`. The script refuses a lunch target whose build type does
not match the variant. Before building it refuses when:

- the tree's filesystem has less free space than `--min-free-gib` (12 GiB by default);
- for `production`, `pixel10aProductProblems` reports anything. Today the descriptor is
  still `UNSET` and the source lock is still `developmentOnly`, so production builds are
  refused;
- the tree fails the source contract check that `scripts/verify-pixel10a-source.mjs` runs
  (manifest, project revisions, overrides, ignored inputs, generated vendor files and factory
  archive). A production build also needs that check to report `developmentOnly: false`.

It then runs, in the tree, as its own process group:

```sh
bash -lc 'set -euo pipefail
unset NINJA_ARGS NINJA_EXTRA_ARGS
source build/envsetup.sh
lunch <lunch target>
m [-jN] droid target-files-package updatepackage otatools-package'
```

The environment is `OUT_DIR=out ANDROID_QUIET_BUILD=true SISO_EXPERIMENTS=ignore-missing-targets
GOMAXPROCS=2 GOMEMLIMIT=18GiB NINJA_HIGHMEM_NUM_JOBS=1`, each settable with the flags above.
Free space is checked every 2 seconds. If it drops below the floor, the group gets `SIGTERM`, and
`SIGKILL` after 120 seconds. An interrupt sent to the runner is passed on to the group.
`--dry-run` prints the lunch target, command and environment, plus every refusal it can find
without hashing the source tree, and builds nothing.

`--out` must be a new directory. The script writes these files into it:

- `source-verification.json`, the source contract evidence;
- `build-start.json` and `image-build.log`;
- `build-result.json`, the build record. It holds the exit code or signal, any free-space stop,
  and the lowest free space seen. It also holds the path, SHA-256 and size of three outputs:
  `out/target/product/stallion/obj/PACKAGING/target_files_intermediates/alpha_stallion_phone-target_files.zip`,
  `out/target/product/stallion/alpha_stallion_phone-img.zip`, and the one `otatools.zip`
  (the Soong `otatools-package` output under
  `out/soong/.intermediates/build/make/tools/otatools_package/otatools-package/*/gen/`). Each
  output must be newer than the build start. The record also has the fingerprints from the
  target-files `PRODUCT/etc/build.prop`, `VENDOR/build.prop` and `SYSTEM/build.prop`. The
  device fingerprint is the product one. `SYSTEM/build.prop` carries the generic system
  image's fingerprint (`Android/generic_system/generic:...`). The device fingerprint must
  name the product, device and Android release, and its build type must match the variant;
- `otatools/`, the unpacked `otatools.zip`. `otatools/bin` is the `--releasetools` for
  `scripts/sign-aosp-release.mjs` and must contain executable `sign_target_files_apks`,
  `ota_from_target_files` and `img_from_target_files`.

`imageBuilt` is `true` only when the build exited 0 and every check above passed.
`imageSigned`, `imageBooted`, `imageFlashed`, `releaseQualified` and `deviceAcceptanceVerified`
always stay `false`. An image build is not a signed image, a boot or a flash.

## Release pipeline

The pipeline must run in the GitHub `release` environment, which supplies the `ALPHA_KEY_*`
secrets that `scripts/release-keys.mjs materialize` reads:

```sh
node scripts/aosp-release-pipeline.mjs --out /absolute/new-pipeline-dir \
  --build-record /absolute/new-build-dir/build-result.json \
  [--keys-base /dev/shm] [--apk-manifest /absolute/apk-manifest.json] [--apksigner /absolute/apksigner] \
  [--map-key SOURCE=NAME ...] [--incremental-from /absolute/previous-signed-target_files.zip]

# or build first, then sign, in one run:
node scripts/aosp-release-pipeline.mjs --out /absolute/new-pipeline-dir \
  --aosp-source /absolute/prepared/stallion-source \
  --factory-image /absolute/stallion-cp3a.261005.005-factory-d1d25502.zip [--jobs N] [--min-free-gib 12] ...
```

The phases run in this order. The pipeline stops at the first one that fails:

| Phase | What runs |
| --- | --- |
| `build` | only with `--aosp-source`: `scripts/aosp-build-image.mjs --variant production --out OUT/build` |
| `build-record` | reads the build record. Refuses one that is not a successful production `-user` build, or whose artifacts, SHA-256 values, fingerprint or releasetools are missing |
| `keys` | `scripts/release-keys.mjs materialize --out <keys-base>/alpha-release-keys-<pid>-<random>`. `--keys-base` must be a tmpfs (`/dev/shm` by default) |
| `sign` | `scripts/sign-aosp-release.mjs --target-files <recorded> --target-files-sha256 <recorded> --keys-dir <materialized> --releasetools <recorded otatools/bin> --out OUT/release` |
| `image` | `<otatools>/bin/img_from_target_files -p <otatools> OUT/release/signed-target_files.zip OUT/release/signed-img.zip` |
| `verify` | read-only checks of the signed outputs; writes `OUT/signed-verification.json` |
| `keys-cleanup` | always runs, including after a failure, and removes the materialized key directory. A signal to the runner also removes it before exiting |

The `verify` phase never opens a private key. It checks that:

- `release-record.json` has no problems and was signed from the build record's target-files
  SHA-256, and that `signed-target_files.zip` and `ota.zip` match the hashes it records;
- `avb_pkmd.bin` is the reviewed `avb.publicKeySha256` of the product and the channel, and
  every `IMAGES/vbmeta*.img` embeds that public key;
- `avbtool verify_image --follow_chain_partitions` passes on the extracted signed images;
- every partition fingerprint ends in `release-keys`, the device fingerprint is the built
  fingerprint with `release-keys`, and `ro.build.type` is `user`;
- `ota.zip` is A/B, carries an `otacert` with the channel's `otaCertificateSha256`, and its
  `post-build` is the signed fingerprint;
- `signed-img.zip` is flat and keeps the unsigned build's `android-info.txt` and
  `fastboot-info.txt`. Each image in it must be the signed target-files image or unchanged
  `RADIO` firmware from the unsigned img zip, and the unsigned img zip must still match its
  build-record hash.

`OUT/pipeline.json` lists every phase with its exact command, `exitCode` and signal, and records
the key directory's removal. Its `passed` and `imageSigned` are `true` only when every phase
passed. `imageBooted`, `imageFlashed`, `signedUpdateApplied`, `releaseQualified` and
`deviceAcceptanceVerified` always stay `false`.

## Limits

`node --test test/aosp-release-pipeline.test.mjs` checks command construction, lunch
selection, the free-space and source-verification refusals, recorded hashes, otatools
unpacking, cleanup of the key directory on every failure path, and the signed-output checks.
Every one of these tests uses an injected runner and synthetic zips. None of this has run an
AOSP build, against a real release-signed target-files, or with real release keys. Production
builds stay refused until the descriptor and source lock are admitted for release in a
reviewed change. Build outputs stay in the tree's `out/`, and a later build overwrites them.
The pipeline re-checks their hashes rather than copying gigabytes. This repository has no
GitHub workflow that runs the pipeline on a self-hosted runner. A passed pipeline is not an
image boot, a flash, an applied OTA, a rollback or recovery drill, or release qualification.
