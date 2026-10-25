# Pixel 11 Pro research and deployment readiness

Research date: October 3, 2026, America/Los_Angeles. **Development flash completed October 4; phone subsequently entered low-level ROM Recovery with a black screen. Recovery remains unresolved.**
The requested device is Pixel 11 Pro (`grizzly`), superseding the older Pixel 10
planning preference for this work. It is distinct from Pixel 11 (`cubs`), Pro XL
(`kodiak`) and Pro Fold (`yogi`). No phone was connected during the initial
inventory; only an SDK emulator and Alpha Cuttlefish were visible. Neither was
rebooted or flashed. This report is preparation evidence, not device acceptance.

**October 4 update:** the resident-agent image and OS-only flash ZIP now build and
pass host artifact validation. A clean repackage fixed a discovered stale AVB
fingerprint. The current candidate is
`artifacts/pixel11-aosp-completed-resident-v2/alpha-grizzly-resident-dev-os-only-img.zip`;
earlier archives are superseded. The physical grizzly has now been observed in
bootloader fastboot and stock fastbootd; firmware matches B1. Before installation, its active slot A
had an incomplete logical OS, while slot B contained an older elizaOS build.
Following the user’s explicit “erase and flash” instruction, the Alpha OS update
completed successfully on A and erased userdata/metadata. Alpha fastbootd booted
during installation; normal Android boot, restoration and hardware acceptance
remain unverified. See the final sections for hashes, checks and physical evidence.
Earlier no-write statements below describe historical preparation stages.

## Findings and source quality

| Area | Verified finding | Consequence |
| --- | --- | --- |
| Official LineageOS | The live official wiki device-data API contained no `grizzly`, `kodiak`, `cubs` or `yogi` entry | No official device support was established. This does not exclude unofficial or private ports |
| XDA primary thread | Browser inspection succeeded after text retrieval returned HTTP 403. All four pages of edcsxz/Reeky’s unofficial LineageOS 24 thread identify **Pro XL/kodiak**, with independent boot/network reports for September 11/13 builds | Stronger XL boot evidence; no Pro/grizzly OS success or complete source closure established |
| Unofficial lead | A September 9 DroidWin article describes a September 8 LineageOS 24 build for **Pro XL/kodiak**, attributing it to Reeky and XDA member edcsxz | Discovery lead only; not an accepted Pro/grizzly build or source. Its download and flashing recipe are not incorporated |
| GrapheneOS releases | No Pixel 11 entry found in the release page; CLI verified-boot key list stops at earlier devices | A partial port is not a qualified distributable release |
| GrapheneOS code | adevtool branch `17` observed at `649267e954063263d53799d3cc53e382ab242893`, September 30; 37 commits beyond our September 3 pin | Review changes individually; do not blindly replace a source/vendor lock |
| Google stable | Official Google China factory/OTA tables list B1 as newest grizzly stable row observed; SHA matches our lock and adevtool index | Retain B1 as the coherent candidate baseline until a new full baseline is qualified |
| Google beta | QPR2 Beta 6.1, September 29: grizzly `CP41.260831.011` | Available diagnostic alternative, not a drop-in B1 firmware upgrade |
| Google GSI | QPR2 Beta 6.1 lists Pixel 11 Pro among validated devices; ARM64 `CP41.260831.007.A3` | Useful generic userspace control on the corresponding supported firmware, not proof of our image |

Primary sources: [Lineage device data](https://api.github.com/repos/LineageOS/lineage_wiki/contents/_data/devices),
[GrapheneOS releases](https://grapheneos.org/releases),
[GrapheneOS CLI guide](https://grapheneos.org/install/cli),
[Google factory table](https://developers.google.cn/android/images?hl=en#grizzly),
[Google OTA table](https://developers.google.cn/android/ota?hl=en#grizzly),
[Google beta factory table](https://developer.android.com/about/versions/17/qpr2/download),
[Google beta release notes](https://developer.android.com/about/versions/17/qpr2/release-notes),
[Google GSI notes](https://developer.android.com/about/versions/17/qpr2/gsi-release-notes).
Unverified lead: [DroidWin article](https://droidwin.com/lineageos-24-android-17-is-here-for-pixel-11-pro-xl/).
XDA access attempt: [KernelSU thread](https://xdaforums.com/t/pixel-11-pro-xl-root-with-kernelsu.4798883/).
Root/recovery success would not establish a custom OS boot even if verified.

The main Google `.com` stable pages returned introductions without device rows in
this session. The official `.cn` pages supplied the rows; this access discrepancy
is recorded rather than treating an absent scraped row as absent support. Searches
are broad but not exhaustive access to all forum posts, private groups or deleted
content. No downloaded unofficial ROM has been treated as trusted code.

## Exact baselines and useful updates

The pinned consumer source is Eliza `91dc19196c307eb8559b9b58de8dbf63eb47f43f`.
Its `packages/os/android/pixel11pro.lock.json` specifies:

- AOSP `android-17.0.0_r1`, manifest commit `5bc9a7ce1cd78dd53613bbfd0ebf506e1e4adb0f`, release config `cp2a`.
- Stock vendor API `202604`, factory `CD1A.260905.001.B1`, stock extracted kernel and DTBO.
- adevtool `144f004cc484d7e7234cdd167cee48e5f240288f`; vendor_state `afd6a0c9f6ca13d395f00e98227a0866cc14de07`.
- Firmware requirements: bootloader `spacecraft-17.4-16238327`, baseband `a900a-MP_260716-260716-M-15880348`.
- Generated super size `10737418240`, group size `10733223936`; logical partitions `system system_dlkm system_ext product vendor vendor_dlkm`.
- Public AOSP userdebug AVB test key. This is not a production/relocking key.

| Artifact | Published SHA-256 | Role |
| --- | --- | --- |
| `grizzly-cd1a.260905.001.b1-factory-4ce23ec8.zip` (15,362,345,907 bytes in lock and live Google HEAD) | `4ce23ec89002abdff0d9b7f3fb32d9efe5741355f4280ee573217dcf426211d3` | B1 stock restoration candidate; hash alone does not prove downgrade compatibility |
| `grizzly-ota-cd1a.260905.001.b1-e2698032.zip` | `e2698032669ec2d92094e0aadbcec79662602faa3af6836b3226bd5a3c5eaff2` | Stock full OTA, subject to recovery acceptance and version constraints |
| `grizzly_beta-cp41.260831.011-factory-6dee5512.zip` | `6dee5512bafe63703fdf502567af488d34651f64469c36acdc53c08b6b125e79` | Separate beta experiment only |
| `aosp_arm64-exp-CP41.260831.007.A3-16450490-9f0bfb9e.zip` | `9f0bfb9e96ed64e2efe4a036b472e29166f62dd09b903d1048a10134e0e396a9` | Separate generic userspace control |

The beta factory and GSI build suffixes intentionally differ. Binary beta release
does not establish availability of a matching full AOSP source graph. Verify tags
against [AOSP manifest refs](https://android.googlesource.com/platform/manifest/+refs)
and record the actual resolved manifest before migration.

The AOSP live refs query returned only `android-17.0.0_r1` among Android 17
release tags. The current grizzly vendor_state commit is still the locked SHA.
GrapheneOS common kernel head was `4435ee7cb14e0462711899309a48e3b1f6b69e1e`
(October 1), including Pixel symbol-list and BTI/AutoFDO work. Its common-kernel
manifest is not our complete device kernel closure.

### Primary XDA thread inspection

The [primary thread](https://xdaforums.com/t/lineageos-for-pixel-11-pro-xl.4800740/)
was read through post 74 using the browser. It links the same Reeky kernel repository
and a public Google Drive folder for kodiak. Its opening instructions still contain
an unresolved stock-firmware placeholder and reference the September 8 build.
Do not turn that recipe into an Alpha installer or flash XL images on grizzly.

The [linked download folder](https://drive.google.com/drive/folders/10qZ2NTJpTJpo_VnQF8aeZjvjlq5_C2x4)
visibly contains September 13 `boot.img` (64 MB), `init_boot.img` (8 MB),
`vendor_boot.img` (64 MB), and `lineage-24.0-20260913-UNOFFICIAL-reeky-kodiak.zip`
(2.1 GB). It does not list the `dtbo.img` or `vendor_kernel_boot.img` required by
the opening recipe. No binary was authenticated or admitted for flashing.

On [page 2](https://xdaforums.com/t/lineageos-for-pixel-11-pro-xl.4800740/page-2),
posts 23–28 report broken internet connectivity, post 31 announces a September 11
fix, and posts 35/38 report successful use and mobile data. One reporter identifies
previous stock firmware as A7. This does not qualify the B1 transition.

On [page 3](https://xdaforums.com/t/lineageos-for-pixel-11-pro-xl.4800740/page-3),
posts 49–51 describe a September 13 update and changed root/kernel behavior;
a reader asks why vendor_kernel_boot disappeared. Posts 53–55 describe camera
failure followed by success after returning to stock and reinstalling. Posts
57–59 report calls, Wi-Fi, mobile data and Android Auto working. These are user
reports, not controlled hardware tests or an explanation of the camera failure.

On [page 4](https://xdaforums.com/t/lineageos-for-pixel-11-pro-xl.4800740/page-4),
post 65 explicitly asks about absent basic/Pro ROMs. Later posts report broken
Lineage customizations and question face unlock. No grizzly success report appears
in the inspected thread. The opening post also contains a separate Fold recovery
author’s claim of Titan M3 decryption and display/touch patches; those patches were
not supplied there and cannot be assumed to work on Pro.

### Additional public code leads

[Reeky's Lineage kernel repository](https://github.com/Reeky-ux/lineage_kernel_google_kodiak)
was found through GitHub repository search, at
`188b1a271525545f55579e6180b67f5673cd6186` (September 13). This is a stronger
primary code lead for the article's named maintainer, but does not authenticate
the article's ROM binary or establish a grizzly OS port. Initial repository searches returned no device trees. Subsequent inspection of
0xnullsect0r’s public forks found kodiak, malibu and spacecraft names, but the
inspected configurations still reference Pixel 10 mustang/muzel/laguna. The kodiak
README explicitly describes unfinished conversion work. These names do not establish
a completed Pixel 11 port; private or unindexed work remains possible.

Its README describes A9, but later commit history replaces device/Kleaf/module
sources with CP41 `kernel-16136351` and pins ACK 6.12.92 at
`8eff909dd82da10a599468a514cc1ad07e90c3cc`. Review the actual manifest and commits,
not the README's older version table. Concrete fixes include matching CP41 vendor
scheduler modules to newer ACK, compiling EdgeTPU sources formerly included
through removed wrappers, and resolving a WLAN MAC-length macro collision.
These are custom-kernel build leads, not B1 stock-kernel boot fixes.

Its manifest still depends on an SSH repository under another account and moving
AOSP dependency branches; its GKI instructions retain tarball-only FIPS prebuilts.
A complete resolved manifest, tarball hashes, toolchain/prebuilt provenance and
module ABI validation remain necessary. No source from this repository was
executed or imported into Alpha. The pinned upstream comment that spacecraft
source is unavailable should be revisited during a reviewed source-pin update;
source availability alone does not establish a reproducible or qualified kernel.

A September 21 [public issue](https://github.com/Reeky-ux/lineage_kernel_google_kodiak/issues/1)
asks for the missing device/vendor trees, exact September 8 ROM build manifest,
and tarball provenance. It had no replies when inspected. The author links an
[HTTPS-manifest/build-wrapper fork](https://github.com/0xnullsect0r/android_kernel_google_kodiak)
and describes device-tree work in progress. This corroborates the reproduction
gap as an open technical question; it is not proof that the original ROM failed
or that any grizzly build succeeded. No issue or message was posted by this task.

[Espada kernel](https://github.com/atrejokm301/espada-kernel) is an author-published
Pixel 11 kernel source repository. Its README claims testing on **grizzly**, an
A9 Google GPL source-drop base and ACK 6.12. It requires a matched boot and
vendor_kernel_boot pair. This is a useful source/driver and XDA lead, but the
claim concerns a custom kernel, not LineageOS or Alpha. Scheduler, LMK, DVFS and
GPU changes introduce extra variables; none is imported into our stock-kernel
baseline. We have not reproduced that build or independently verified the claim.

[PowerPhone's Pixel AOSP manifest](https://github.com/PowerPhone/pixel_aosp_manifest/tree/4664b65e3a1c955bc409c9b8ffd41d67ca4589dd)
reports repeated AOSP boots on **cubs**, not grizzly. Its
[validation notes](https://github.com/PowerPhone/pixel_aosp_manifest/blob/4664b65e3a1c955bc409c9b8ffd41d67ca4589dd/docs/validation.md)
identify an early-boot AVB/fstab mismatch. The
[malibu topology patch](https://github.com/PowerPhone/pixel_aosp_manifest/blob/4664b65e3a1c955bc409c9b8ffd41d67ca4589dd/patches/adevtool/0002-malibu-avb-chain-topology.patch)
and [fstab helper](https://github.com/PowerPhone/pixel_aosp_manifest/blob/4664b65e3a1c955bc409c9b8ffd41d67ca4589dd/scripts/lib/cubs-fstab.sh)
restore child mappings for boot, init_boot, vbmeta_system and vbmeta_vendor;
vendor_dlkm remains rooted in vbmeta. This is a specific code lead, not proof of
the cause of any grizzly failure. Our pinned malibu BoardConfig contains no
explicit child-chain definitions; the Alpha/upstream grizzly preparation does
not reconstruct these either. Included AOSP makefiles and the final packaged
images determine the effective topology, so absence in one file is not proof
that the final image is wrong.

The exact pinned [adevtool `copy.ts`, lines 184–205](https://github.com/GrapheneOS/adevtool/blob/144f004cc484d7e7234cdd167cee48e5f240288f/src/blobs/copy.ts#L184-L205)
confirms that `patchFstab` replaces named AVB targets with root `vbmeta`, removes
`avb_keys=no_such_key`, and changes file/metadata encryption to wrapped-key
options. This is observed source behavior, not an inferred transformation.
Include KeyMint, metadata encryption and encrypted-data reboot validation in
bring-up; a storage wait or graphics override cannot establish those contracts.
Do not combine stock chained fstabs with flattened generated vbmeta, or the
inverse, without rebuilding and validating the complete graph.

Required comparison: extract both grizzly vendor and first-stage-ramdisk fstabs;
resolve every `avb=` dependency against actual AVB descriptors, child image keys,
rollback locations and the flash/OTA image lists. Cryptographic AVB verification
alone does not establish that fs_mgr loads the same dependency graph. A topology
change also requires a reviewed source lock and release image list; do not append
untracked fastboot commands. Review its devnode-mode and merged-cpio-root patches
against our exact AOSP init/ramdisk tooling if early `/dev` creation fails. These
remain unported hypotheses pending actual grizzly artifacts. Its product UI,
identity, cubs firmware and flash scripts are not Alpha target inputs.

GrapheneOS [release 2026100200](https://grapheneos.org/releases#2026100200) includes
a kernel mmap read-ahead correction for QPR1 memory-pressure stuttering and the
kernel-tarball processor. It still does not list Pixel 11 among release targets.
This is a concrete later graphics/performance diagnostic lead if a QPR1 base is
adopted; it does not establish a B1 fault.

### Provisional inspection of Google's exact B1 archive

Read-only HTTPS range requests inspected the outer/nested ZIP central directories
and three small vbmeta images from the pinned Google factory URL. These bytes
are **not yet authenticated against the complete published factory SHA-256**.
The retained metadata and `avbtool info_image` output are provisional diagnostics,
not signature verification, rollback compatibility or restoration acceptance.

- Stock root vbmeta reports MLDSA65, flags 0, rollback index `1788220800`.
  Its chain descriptors target boot/location 2, init_boot/location 4,
  vbmeta_system/location 1 and vbmeta_vendor/location 3.
- vbmeta_system contains pvmfw, product, system, system_dlkm and system_ext;
  vbmeta_vendor contains vendor. Root contains vendor_dlkm plus boot-support
  and firmware descriptors. This strengthens the relevance of the topology lead
  to grizzly stock, without proving the generated Alpha graph is defective.
- `fastboot-info.txt` explicitly flashes both child vbmeta images, transitions to
  fastbootd, updates super, writes the six logical partitions, writes system_other
  to the other slot, and conditionally erases userdata and metadata. A stock
  restoration may therefore invalidate assumptions about an untouched rescue slot.
- `android-info.txt` matches our pinned bootloader/baseband but permits spacecraft,
  kodiak/kodiak_2, grizzly/grizzly_2, cubs and yogi. That shared board check does not
  replace exact serial, model and SKU admission.
- The root's stock algorithm differs from the candidate's public RSA4096 test key.
  Do not transplant a stock vbmeta image into a custom image set, infer custom-key
  support from a parser, or relock. Require the candidate's own consistent graph
  and scoped device qualification.

Recheck the small-image byte hashes against the fully downloaded authenticated
archive before treating these observations as accepted stock-reference evidence.

### GrapheneOS changes to review

1. [Kernel module iteration fix, `86379fd`](https://github.com/GrapheneOS/adevtool/commit/86379fd6411ce203e1cd0ccd38d1b84aca6d0421): copies system_dlkm before vendor_dlkm/vendor_kernel_boot. Relevant to extraction and module pairing; regenerate, hash and compare output before admission.
2. [Kernel tarball processor, `649267e`](https://github.com/GrapheneOS/adevtool/commit/649267e954063263d53799d3cc53e382ab242893): converts supplied Pixel kernel source tarballs into Git commits. It is tooling, not a complete reproducible grizzly kernel/toolchain/module contract.
3. [Full comparison](https://github.com/GrapheneOS/adevtool/compare/144f004cc484d7e7234cdd167cee48e5f240288f...649267e954063263d53799d3cc53e382ab242893): includes QPR1 vendor/parser changes, carrier/modem backports, config.fs handling and beta indices. These expand compatibility obligations. At the observed head, `common/gen11pixel.yml` still selects A9 by default; Alpha's B1 override must remain explicit.
4. [Malibu kernel PR #29](https://github.com/GrapheneOS/kernel_common-6.12/pull/29) merged August 27. [BTI/AutoFDO fix](https://github.com/GrapheneOS/kernel_common-6.12/commit/3031767d5fd1ff6717a7c691653fc8361d0fc911) addresses hardened-kernel early boot. It is not evidence that our stock kernel has the same fault. Keep compiler, KMI, modules, DTBO and boot image headers coherent.

GrapheneOS's [MTE discussion](https://discuss.grapheneos.org/d/41564-pixel-11-doesnt-meet-the-grapheneos-security-standards-and-may-be-skipped)
initially described absent support; [later official comments](https://discuss.grapheneos.org/d/41564-pixel-11-doesnt-yet-meet-the-grapheneos-security-standards-and-may-be-skipped/372) revised this to
hardware support with firmware/OS enablement unresolved. Do not repeat the initial
hardware-absence claim as settled. MTE qualification and basic AOSP boot are
separate questions. Do not enable OEM MTE switches or replace the stock kernel as
an incidental part of bringing up Alpha.

## Script audit against our product

| Code in pinned `vendor/eliza/packages/os` | Existing protection / limitation | Alpha action |
| --- | --- | --- |
| `scripts/distro-android/prepare-grizzly.ts` | Hash-bound inputs, generated vendor geometry, stock kernel, stamped init/graphics/fstab diagnostics | Keep stock ordering and default diagnostics off; generated inputs must match final images |
| `scripts/aosp/build-grizzly-bundle.ts` | Source closure, APK provenance, host init, AVB and bundle evidence | It expects the upstream privileged Eliza product; Alpha development product staging does not satisfy its app contract |
| `scripts/distro-android/verify-grizzly-artifacts.ts` | Packaged image/stamp inspection, graphics/fstab/probe checks, ELF alignment | Run against the actual Alpha candidate after an explicitly reviewed consumer integration |
| `scripts/android/install-release.ts` | Signed v2 contract, explicit serial, SKU/capacity/firmware/battery checks, snapshots/slot state, verified files/tools, stop on failure, journal, postboot identity | Reuse protections through a reviewed Alpha adapter; no direct bypass or handwritten fastboot loop |
| `scripts/android/release-contract.ts` | Independent signatures and physical qualification, exact source/firmware/recovery evidence | Current trust keys are empty; hardware inventory denies both production and lab flashing |
| `android/installer/install-elizaos-android.sh` | Legacy planning; confirmed execution routes to v2 | Do not treat old `--image` planning as a flash authorization |
| `scripts/aosp/deploy-pixel.ts` | Physical lane checks an already flashed upstream privileged image | Not an Alpha flasher; its hard-coded package-path/fingerprint expectations are not Alpha acceptance |
| Alpha `scripts/stage-aosp.mjs` | APK hash/signer/HOME admission, additive nonprivileged Alpha module and DeskClock | Preserves product identity; development grizzly configuration staged, but source/image validation, signing and default-HOME/recovery qualification remain |

The prepared output is not yet an Alpha physical distribution. Do not rename an
Eliza bundle, copy its UI, weaken its privileged-APK checks or set inventory
eligibility to true to get past this boundary. Generic corrections require a
reviewed upstream commit or an explicit tested patch, never editing the pinned
submodule checkout. An Alpha product adapter must bind Alpha package/signer,
manifest and expected fingerprint without importing the other product's identity.

### Alpha physical product staging

A development-only grizzly product now lives in `android/aosp/grizzly/` and can be
staged with the already verified Alpha launcher:

```sh
npm run aosp:stage -- --apk artifacts/launcher-debug.apk --development \
  --target grizzly --output artifacts/pixel11-alpha-product
```

The generated directory is intended for `vendor/alphaphone` in an independently
prepared source tree. It registers `alpha_grizzly_phone-cp2a-userdebug`, inherits
the generated grizzly hardware product and Alpha's additive nonprivileged overlay,
and retains AOSP provisioning/HOME alternatives. It does not inherit Eliza's
common product, grants, role overrides or UI. The output records the APK hash,
source-lock digest and source pin in `physical-product.json`.

Staging, product configuration, Soong analysis and Make packaging generation
have passed against the inspected launcher APK. The complete grizzly image build
is still running. Effective AVB/fstab policy, image validation and Alpha release adapters
remain unfinished. The upstream device lock supplies reference inputs; its Eliza
fingerprint/app contract is not an Alpha release contract. The target option is
rejected outside development staging. No file in a live AOSP checkout is modified
by this command.

### Boot and graphics investigation order

- Establish boot stage first: kernel, module loading, storage mount, init/APEX,
  vold/KeyMint/keystore, zygote, SurfaceFlinger, then HOME. A visible logo alone
  does not locate the failure. Capture logs before resets where possible;
  persistence of pstore/OEM last_dmesg must be demonstrated, not assumed.
- Retain stock module and storage waits. Nonblocking `vdc keymaster
  earlyBootEnded` and conservative-fstab switches are diagnostic experiments,
  not fixes that establish encrypted storage correctness.
- The preparation script documents PowerVR/native EGL, ANGLE selection and
  Vulkan/Skia Graphite. ANGLE selection requires packaged ANGLE libraries.
  A GL RenderEngine experiment must disable Graphite to actually select GL.
  Test one override at a time with a new stamped image; record SurfaceFlinger,
  composer3, allocator, Vulkan/EGL, tombstones, display/touch and suspend evidence.
- The vendor sepolicy version rewrite remains a qualification blocker. Check
  actual VINTF/FCM mappings and enforcing boot; rewriting a version or turning
  SELinux permissive does not establish compatibility.
- Check effective `lpdump` metadata, not only BoardConfig text. The earlier
  [10 GiB super fix](https://github.com/GrapheneOS/adevtool/commit/97c519464a1cbe49b59aeff5143ba8edb44a98d9)
  distinguishes first boot from working OTA. Never assume an alternate slot
  remains a complete stock rescue after dynamic-super changes.

## Non-destructive preflight

```sh
npm run aosp:preflight -- --output artifacts/pixel11-preflight.json
# Optional, explicitly selected attached phone; no reboot is performed:
npm run aosp:preflight -- --device EXACT_SERIAL --mode adb
# Only if the operator has already put that phone in bootloader mode:
npm run aosp:preflight -- --device EXACT_SERIAL --mode fastboot
# Hash a locally acquired stock factory archive (streamed, not loaded into RAM):
npm run aosp:preflight -- --factory /absolute/grizzly-b1-factory.zip
```

The command returns **2 for preparation blocked**, 1 for invalid input/error.
It has no execution, unlock, reboot, relock, erase or installation option. It
collects only specific read-only properties/getvars and hashes the serial in its
report. Output uses exclusive creation and mode 0600. Device connection, battery,
firmware and snapshot facts expire; recapture immediately before a separately
qualified installation. This tool deliberately cannot promote the device to
ready: signed image and physical recovery acceptance live in the release lane.

The offline recovery verifier checks the complete pinned SHA-256 before inspecting
both ZIP layers, CRCs, required image members, grizzly board admission and the
pinned bootloader/baseband requirements. It reads stored nested ZIP data without
extracting another factory-sized file. It never executes Google's scripts or
contacts a device. Run it only after the download is complete:

```sh
python3 scripts/verify-pixel11-recovery.py \
  artifacts/pixel11-recovery/grizzly-cd1a.260905.001.b1-factory-4ce23ec8.zip \
  --output artifacts/pixel11-research/recovery-verified.json
```

Six synthetic cases cover valid-but-not-qualified output, a missing child vbmeta,
wrong firmware, duplicate entries, inner corruption with a matching outer digest,
and tamper/symlink rejection. A passing fixture test is not a passing real factory
inspection. The full archive check has now passed against the isolated local copy;
physical restoration remains untested.

## Recovery and deployment sequence

1. Capture stock identity, regional SKU, capacity, full fingerprint, bootloader,
   modem, lock/unlock ability, both slots, page size and current update/snapshot
   state. Confirm a user-approved backup can actually be restored, including
   authenticator/passkey/eSIM recovery through the user's existing arrangements;
   do not collect credentials. Ensure sufficient battery, stable USB/power and a
   tested spare cable/port. Unlock and wipe are later explicit device operations.
2. Acquire the exact grizzly factory and full OTA from Google. Verify published
   hashes, ZIP integrity, inner android-info and flashing metadata. Keep them and
   verified platform-tools offline on the flash host. The currently locked B1
   archive is a candidate; if the phone is on a newer firmware/rollback level,
   stop and qualify an equal-or-newer supported stock restoration path instead.
3. Rehearse stock recovery access and approved stock restoration on the exact
   model/firmware in the lab. A full OTA normally avoids unlocking/wiping when
   accepted by stock recovery; it is not a universal custom-OS downgrade rescue.
   A factory restoration can erase data. Neither can undo blown rollback fuses.
4. Build the Alpha-specific complete image bundle. Retain source graph, toolchain,
   kernel/module/vendor hashes, init/VINTF checks, AVB chain/rollback metadata,
   partition geometry, APK signer and exact flash-plan artifacts. Build and test
   Cuttlefish separately; retain stock Launcher3/Settings as the HOME recovery route.
5. Admit a scoped first-boot lab experiment with the exact device and recovery
   contract. Production qualification cannot precede that experiment. The current
   inventory and absent keys do not authorize even this lab lane; enroll a reviewed
   scoped contract, never fabricated physical evidence. Do not relock a test-key,
   diagnostic, mixed or unqualified image.
6. During a flash failure, stop subsequent writes/activation/reboot and retain the
   journal. Determine whether bootloader or recovery remains reachable. Use the
   previously rehearsed OEM restoration path for the current rollback state.
   Do not automatically switch slots, erase super, retry random partitions or
   relock. Boot-chain/USB/power failure can still require manufacturer service;
   software preparation cannot guarantee an unbrickable phone.
7. Validate the exact slot/fingerprint/APK after boot, encryption/keystore across
   reboots, enforcing SELinux, graphics/touch, camera, audio/mic/Bluetooth, radios
   and IMS, Wi-Fi, charging/thermals/suspend, HOME fallback, resident agent and
   voice. User-visible phone/SMS features disabled in Alpha do not waive OS radio
   and emergency-function qualification. Do not make test emergency calls.
8. Separately test full/incremental OTA, interrupted OS update, snapshot merge,
   slot fallback, downgrade rejection and verified stock restoration. Do not
   power-cut a bootloader/firmware update as a casual fault-injection experiment.
   Only then create production signing/qualification and user-acceptance evidence.

Underlying references: [Google stock recovery instructions](https://developers.google.com/android/ota),
[Google factory instructions](https://developers.google.com/android/images),
[AOSP Virtual A/B](https://source.android.com/docs/core/ota/virtual_ab),
[AVB rollback protection](https://android.googlesource.com/platform/external/avb/+/master/README.md).

## Retained verification

Raw research snapshots, command logs and local reports are under ignored
`artifacts/pixel11-research/`. They are not release qualifications. The dated
machine-readable ledger in `docs/evidence/pixel11-readiness-2026-10-03.json`
records final results and remaining dependencies. No physical boot, restore,
firmware update or hardware acceptance was performed during this preparation.

### Isolated source preparation

All 1,084 locked AOSP projects and three external projects have been checked out
in `artifacts/pixel11-aosp`, independently of the existing working tree. Git object
alternates still depend on the existing local cache; this is not a portable source
archive. Dependency installation completed without changing tracked adevtool files.

The first source audit passed project revision, remote and nonignored-status
checks, then rejected the three manifest-linked build/make trees. Investigation
proved a permission-only difference: the pinned tree hashes encode group-write
bits, while the fresh checkout uses 0644/0755. Computing the hashes with those bits
reproduced all three expected digests. Only the isolated checkout's regular files
in those trees were adjusted to the locked modes, after verifying ownership by
the current user and primary group and a single hard link. File contents and the
upstream checkout were unchanged. The full local audit subsequently passed for all 1,087 projects and the manifest
root entries. Pinned overlays and host-tool preparation may proceed; this baseline
is not a final image/source snapshot or a physical boot test.

Pinned source overlays have now passed their base and downloaded SHA-256 checks.
The seven staged Alpha product files were copied into isolated `vendor/alphaphone`
and verified byte-for-byte, including the launcher APK and reference-lock digest.
The extraction host tools completed successfully with four jobs. No grizzly image exists
yet, and the clean baseline predates these explicitly recorded additions.

All four current APK outputs (standalone/launcher, debug/unsigned release) passed
SDK 36 `zipalign -c -P 16 4`. Their four packaged arm64 libraries each have ELF
LOAD alignment of at least 16 KiB and matching offset/address congruence. This
checks packaged native loadability prerequisites, not physical execution, complete
image alignment or working speech/camera on grizzly.

The read-only Node preflight now hashes through one non-following open file
descriptor and checks both that descriptor and the named path for replacement or
mutation. A deterministic path-swap test passes even when replacement bytes are
identical. The full repository verification passed again with 266 tests.

XDA post 72 exposes kernel/Android log attachments, but direct retrieval returned
HTTP 403 and browser download timed out. Their contents were not inspected and
are not treated as boot, graphics or firmware evidence.

A follow-up GitHub repository search explicitly including forks found zero
`android_device_google_grizzly` repositories and one `android_device_google_kodiak`
repository: the already inspected unfinished 0xnullsect0r fork. This is a bounded
search result, not proof that no differently named, private or unindexed port exists.

The Python archive verifier likewise checks the final pathname against its open
descriptor and uses nonblocking open so pipes are rejected immediately. Eight
synthetic archive cases pass, including replacement with identical bytes and a
pipe without a writer. Full repository verification remains green at 266 tests.

The host dependency build completed with exit code zero and 8,966 executed build
steps after Soong analysis. All 14 required executables are present; their hashes,
the two Java archives, build-log hash and bounded version/help launch results are
recorded in `artifacts/pixel11-research/host-tools-built.json`. Some tools return
nonzero usage exits, and arsclib requires its JSON interface rather than `--help`;
these launches do not establish successful factory extraction or resource
conversion. The exact adevtool revision stamp is now installed. Vendor generation
is now proceeding from the complete, digest-verified Google factory archive.

An exact Google factory archive was found in the existing local recovery cache.
Its full published SHA-256, outer and inner ZIP CRCs, firmware requirements and
required image set passed the verifier. An isolated copy was rehashed and fully
reverified, and all three previously observed stock vbmeta hashes match it. The
redundant network download was deliberately stopped only after this copy was
verified. `artifacts/pixel11-research/recovery-verified.json` records the result.
This establishes an intact stock recovery artifact, not compatibility with an
unobserved device rollback state or a successful restoration drill.

Pinned grizzly vendor generation subsequently completed with exit code zero. Its
16 required-file checks, vendor VINTF API check and graphics-stack assertions
passed. The prepare stamp retains native graphics defaults, with early-boot
probes, conservative F2FS and keymaster nonblocking changes disabled. Generation
reported one additional stock carrier file,
`vendor/etc/mdota/custom/carrier_config_a900a-MP_260716-260727-M-15947729`.
The adevtool checkout is clean after its temporary locked-reference override.
The generated fstab does contain the previously identified `avb=vbmeta` rewrite;
its compatibility with the eventual image graph is still an image-validation
requirement, not a boot failure established by this source inspection.

The Alpha development source audit passed all 1,087 project revisions/remotes and
nonignored changes, exact overlay hashes, root-entry closure, generated vendor
checks and staged Alpha file hashes. Both generated trees are bound by digest.
The image build reuses `out_adevtool_deps` as its sole output root; host-tool
outputs remain output data rather than an extra authorized source tree. This is
not final signed-release admission or a complete ignored-dependency audit.

`alpha_grizzly_phone-cp2a-userdebug` resolves successfully to Android 17/grizzly
with source security patch `2026-06-05`. Its separate AVB chain variables are
unset, unlike the verified stock reference. A local `target-files-package` build
is running for image inspection with four jobs. This 30 GiB host does not meet
the upstream dedicated release builder requirement of 128 GiB RAM and 600 GiB
free disk; a local development build cannot satisfy that release gate. No patch
level was raised to disguise the source date, and no flashing admission follows
from starting or completing this build.

The pinned `verify-grizzly-artifacts.ts` is not sufficient for this product:
its filesystem reader invokes ext4 debugfs after optional sparse conversion,
whereas generated grizzly images use EROFS. Its ELF walk is limited to unpacked
`system/priv-app/Eliza` libraries and skips that directory when absent. Final
Alpha validation must use EROFS-aware image inspection and verify the actual
packaged Alpha APK. Earlier APK alignment results do not by themselves prove
which APK the image contains.

Stock ML-DSA verification exposed two bugs in the locked AOSP avbtool: decoding
calls `hex()` on bytes, and verification compares the raw key length against a
length that includes the four-byte AVB prefix. A separate research copy fixes
those two operations. It verifies all three authenticated stock vbmeta signatures
and rejects a one-byte signature corruption for each. The patch and tool hashes
are retained under `artifacts/pixel11-research/`; the active AOSP source was not
modified. This is candidate-tool signature evidence against embedded keys, not
a reviewed source update, full descriptor-chain traversal, device key enrollment
or rollback compatibility.

Google commit [d81a408](https://android.googlesource.com/platform/external/avb/+/d81a4087883417ea4334b87c76d03ae9ff29049b%5E%21/)
independently fixes the same byte-conversion defect. The isolated two-fix
candidate additionally passed ML-DSA-65 and ML-DSA-87 valid/corrupt signature,
changed-message and bad-key-size cases, plus RSA-2048 valid/corrupt signature
regressions. Generated test private keys were temporary and removed. This does
not establish that the separate key-length fix has been adopted upstream.

The host-only correction is now retained under `android/aosp/host-tools/`, with
exact base, patch and result digests. Create a fresh standalone copy and run its
regression checks without changing either source checkout:

```sh
python3 -B scripts/prepare-pixel11-avbtool.py \
  --aosp-root artifacts/pixel11-aosp --output artifacts/pixel11-avbtool-new
python3 -B scripts/test-pixel11-avbtool.py \
  --candidate artifacts/pixel11-avbtool-new/avbtool.py \
  --aosp-root artifacts/pixel11-aosp
```

Preparation refuses a mismatched base or patch and an existing output directory.
The regression runner rejects a mismatched tool before importing it. These
rejection cases and the ML-DSA/RSA cases passed. This standalone verifier does not
update the AOSP lock, enroll signing keys, or authorize a flash.

The complete stock AVB traversal now passes using the hash-pinned standalone
verifier: root vbmeta, boot and init_boot footer/signatures, vbmeta_system and
vbmeta_vendor signatures, and every covered hash/hashtree descriptor. The tool
checks each child public key against its authenticated parent descriptor. Raw
image hashes and command output are retained in the stock-chain audit reports.
The root trust anchor here is the published complete factory SHA, not an observed
phone key store. Modem and other factory files outside that AVB graph remain
covered by archive integrity; this does not claim every factory member has an
independently verified embedded signature or that device rollback permits it.

The reusable authorization boundary is more specific than the upstream bundle
builder: `validateEnvelope(envelope, policy)` accepts explicit trust/inventory,
and lab qualification checks stock baseline, recovery, firmware/rollback policy,
Cuttlefish boot and artifact validation. It does not require the production
privileged-app case for the lab lane. The existing installer CLI still loads its
upstream policy, and postboot/runtime expectations need Alpha adaptation. Reuse
of these APIs does not enroll a key, make the grizzly inventory eligible, or
qualify an unknown device starting state.

The image build also reports D8's unsupported-API warning for API 37. The locked
prebuilt is D8 9.2.12-dev, source commit
`3bec476bbff78407704bff11caa40ea817fcb8fa`; its latest modeled API is 36.1.
The corresponding [compiler validation source](https://r8.googlesource.com/r8/+/3bec476bbff78407704bff11caa40ea817fcb8fa/src/main/java/com/android/tools/r8/BaseCompilerCommand.java)
emits a warning, while its
[API mapping](https://r8.googlesource.com/r8/+/3bec476bbff78407704bff11caa40ea817fcb8fa/src/main/java/com/android/tools/r8/utils/AndroidApiLevel.java)
maps 37 to development `MAIN`. Compilation continues with the pinned compiler.
This explains the diagnostic; it does not qualify resulting dex execution or
physical Android 17 compatibility. Compiler and inspected-source hashes are
retained in `artifacts/pixel11-research/d8-api37-warning.json`.


### October 4 APK packaging correction

The image build stopped after 104,395 resumed actions because the presigned Alpha
APK contained compressed JNI entries. The check was retained.
`scripts/prepare-aosp-apk.py` now prepares an unsigned APK with stored native
entries and 16 KB alignment while checking that every payload entry is unchanged.
The prepared launcher release-mode APK was signed with a separate development-only
key and passed signature verification and the exact AOSP presigned APK check.
This key is not a production signing authority.

Pinned PackageAbiHelperImpl code also confirms that bundled system apps do not
extract embedded JNI libraries. The grizzly staging helper now installs the four
ARM64 JNI libraries beside `/product/app/AlphaPhone/AlphaPhone.apk`, under
`lib/arm64`, and records each hash. Five native-staging rejection cases and five
APK-preparation rejection/preservation cases passed. Repository verification passed.
All 1,087 source projects and both bound trees passed a fresh input audit.
The incremental image build subsequently completed successfully; the October 4
validation below supersedes that pending status. Previous generated products and
failure evidence were kept.

The inspected APK includes camera and speech JNI libraries but lacks the resident
agent executable payload. This is an explicit remaining product-readiness gap.
No physical device has been flashed; APK packaging success does not establish
image boot, native library loading, agent execution, hardware behavior or restore.
Evidence: `artifacts/pixel11-research/alpha-build-apk-packaging-failure.json`,
`artifacts/pixel11-aosp-apk/signed-validation.json`,
`artifacts/pixel11-research/alpha-build-inputs-packaging-v2.json`, and
`artifacts/pixel11-research/alpha-grizzly-build-packaging-v2.log`.

The first native-file module approach (`prebuilt_any`) was rejected by Soong's
neverallow rule, which restricts that type to generated build rules. This was
not bypassed. The replacement uses the supported Make APPS prebuilt rule with
`LOCAL_PREBUILT_JNI_LIBS`, `PRESIGNED`, SDK 36 and disabled dex preoptimization.
That rule preserves the APK bytes and retains JNI/DEX compression and alignment
checks. The staging helper requires the exact fresh upstream-generated overlay
before replacing its module declaration. JNI and DEX storage were checked on the
signed candidate; its hash is unchanged because the original DEX was already
uncompressed. Previous product staging was preserved as build-v2 evidence.


### October 4 completed development image validation

The `alpha_grizzly_phone-cp2a-userdebug` target-files build completed successfully.
The 3,604,827,003-byte archive contains 7,653 entries, with no duplicate names and
all entry CRCs passing. Its SHA-256 is
`1fe28a4df73f0fd11ff1761eb67c7615b93ee35854134b1a6228df7c26fb7d74`.
This supersedes earlier build-pending statements; historical failure records
remain unchanged.

The actual vbmeta signature and all 12 covered partition hashes/hashtrees passed
verification against the expected public AOSP RSA4096 test key. AVB flags are zero.
The calculated vbmeta digest matches the target-files metadata. Its rollback index
is `1780617600` (June 5), below the inspected stock root's `1788220800` (September 1).
Neither signature validity nor an unlocked bootloader assumption establishes that
a particular phone will accept this rollback state. Device compatibility remains
unverified, and these test keys are not suitable for production or relocking.

All six logical EROFS filesystems passed full extraction. The launcher extracted
from `product.img` and all four installed ARM64 JNI libraries match their staged
SHA-256 values. The extracted APK passes signature verification and 16 KB ZIP
alignment; each extracted ARM64 library has compatible 16 KB load-segment
alignment. Their installed mode is 0644, appropriate for these shared libraries.
The resident-agent executable payload is still absent.

The six logical images total 2,078,494,720 bytes and fit the configured dynamic
partition group. Fixed boot image sizes also fit the build configuration. This is
not a physical partition-size observation. The generated fastboot recipe writes
`system_other.img` to the opposite slot and can erase userdata and metadata;
it does not promise an untouched fallback slot or automatic rollback.

Evidence: `artifacts/pixel11-research/alpha-build-completed-v3.json`,
`alpha-target-files-integrity-v3.json`, `alpha-built-image-validation.json`,
`alpha-built-erofs-validation.json`, and `alpha-built-launcher-validation.json`
in the same research directory. Only the SDK and Cuttlefish emulators remain
visible to ADB; fastboot reports no device. No physical phone has been flashed.
Image boot, hardware acceptance, resident-agent execution, release admission and
a physical restore drill remain incomplete. Deployment readiness remains false.


### Packaging regression coverage and resident-agent preparation

Nine permanent offline tests now cover APK payload preservation, v1 and signing
block rejection, duplicate/unsafe entries, preservation of existing outputs and
changed overlays, invalid native payloads, and post-alignment DEX storage.
`prepare-aosp-apk.py` now explicitly checks the DEX storage postcondition before
writing its success report. The tests stub zipalign and do not establish real
alignment; the updated helper was also run with SDK 36 zipalign on the actual
unsigned launcher. Its output remains byte-identical to the prior prepared APK.
Evidence is `artifacts/pixel11-aosp-apk-regression-v4/preparation.json` and
`artifacts/pixel11-research/aosp-packaging-regressions.log`.

The resident runtime requires Bun 1.4.2; this host's default is 1.3.14. A separate
1.4.2 executable was downloaded from the official release, checked against the
GitHub release asset digest and version-tested without replacing the host default.
Provenance is in `artifacts/pixel11-host-bun-1.4.2/provenance.json`. This prepares
the build tool only; dependency installation, workflow/mobile bundling, system-app
executable modes and device execution remain pending.

Full repository verification passed after the regression addition: 267 Node
tests, TypeScript and the web production build. This host-script change does not
change either Android variant or the already-built grizzly image.


### Actual boot-image comparison: inherited MTE configuration

The completed image's kernel and DTB are byte-identical to the verified stock B1
components. All three ramdisks were decompressed and inventoried; both first-stage
fstabs match their generated vendor inputs. Evidence:
`artifacts/pixel11-research/alpha-built-boot-validation.json`.

The vendor boot command line is not identical to stock. It adds
`bootloader.pixel.MTE_FORCE_ON` and `kasan.fault=panic`, while removing stock
`kasan=off`, `init_on_alloc=0`, `init_on_free=1` and a dynamic-debug setting.
The first two additions come from the pinned adevtool
`config/mk/google_devices/common/BoardConfig-armv9.mk`, inherited through Malibu.
That board file also enables `memtag_heap` globally and declares ARM MTE support.
The built command line contains `bootconfig` twice. Neither inspected vendor boot
header contains `arm64.nomte`; firmware can supply additional boot arguments, so
this does not disprove GrapheneOS's observations on other baselines.

This is a newly identified configuration gap in the stock-baseline approach, not
an observed phone failure. The existing candidate remains barred from deployment
pending review and resolution of these inherited defaults. Preserving the stock
kernel alone does not preserve stock boot configuration or establish MTE support.
No OEM MTE command, replacement kernel, or configuration change was made during
this audit.


### Completed VINTF compatibility check

The packaged AOSP `check_target_files_vintf` tool passed against the completed
target files. A verbose run confirms `COMPATIBLE`, shipping API 37, empty hardware
and vendor SKU variants as configured, APEX manifests and supplied kernel config
checks. All 127 inspected VINTF XML and APEX/CAPEX files match the corresponding
files extracted from the actual built EROFS images.

The tool warns that kernel level `202504` from the stock kernel release
`6.12.69-android16-6-g5c5f2fea42dd-ab15835541-4k` differs from the manifest's inferred
`202604`. The pinned `VintfObject.cpp` deliberately retains the release-derived
level in that case; the check therefore does not establish kernel-level 202604
qualification. No version string or manifest was changed to suppress the warning.
Other warnings concern absent optional ODM build properties and unprivileged
extraction of boot device nodes; the verbose command confirms that kernel version
and configs were supplied and compatibility checks ran.

Evidence: `artifacts/pixel11-research/alpha-built-vintf-validation.json` and
`alpha-built-vintf-verbose-validation.log`. This is host compatibility evidence,
not proof that HALs start, graphics render, radios work, or the phone boots.
The inherited MTE configuration finding and physical-device gates remain open.


### Stock-baseline board correction (source validated; image rebuild pending)

`prepare-grizzly-stock-board.py` now checks exact hashes of the generated B1 board,
B1 product makefile and two inherited adevtool board files, then emits a new
BoardConfig into a separate artifact directory. It rejects changed or redirected
inputs and existing outputs. Its Alpha-only fragment removes inherited MTE forcing
and global memtag sanitizers, restores B1's `kasan=off`, `init_on_alloc=0` and
`init_on_free=1`, and leaves AOSP to add `bootconfig` once. Other sanitizer flags
are preserved. This is a stock-kernel development profile, not GrapheneOS security
qualification; the removed dynamic-debug flag is not restored.

Seven tests passed, including actual GNU Make evaluation, nonstock-kernel refusal,
other-product preservation and refusal before mutation. The prepared replacement
was applied only to the generated `vendor/google_devices/grizzly/BoardConfig.mk`;
the original is retained alongside its preparation report. No pinned checkout was
edited. AOSP's actual dumpvars confirms the intended command line, no global
sanitizers in this configuration, and `USE_STOCK_KERNEL=true`. Full repository
verification passed 268 tests, TypeScript and the web build.

Evidence: `artifacts/pixel11-stock-board-policy-v1/preparation.json`,
`artifacts/pixel11-research/alpha-stock-board-policy-applied.json`,
`alpha-stock-board-policy-resolved.json`, and `verify-stock-board-policy.log`.
The completed v3 image still contains the prior configuration: it has not been
silently relabeled or qualified by this source-only correction. Rebuild and
inspection of the next image are required.

Resident-agent preparation has meanwhile completed frozen dependency installation,
the workflow-worker artifact build, and Android ARM64/x86_64 runtime staging,
including the mobile bundle's host load smoke check. These are build/staging
results, not Android execution. Both Android variants are being rebuilt with the
payload; pre-resident APKs were preserved in
`artifacts/pixel11-apks-before-resident`.

The resident-payload Android build subsequently passed for both variants, including
debug, unsigned release, instrumentation assembly, lint and APK verification. All
four APKs contain the agent bundle and ARM64 Bun runtime. Hashes are recorded in
`artifacts/pixel11-research/alpha-resident-apks.json`. No emulator instrumentation
or physical resident-agent execution is claimed by that build result.

The new resident launcher was prepared with stored JNI/DEX entries, aligned and
signed using the same development-only APK key. Signature and 16 KB ZIP alignment
checks pass; all 36 declared runtime provenance files match their packaged hashes
and sizes. Signed APK SHA-256:
`c4e102dd8e7a3a5df87c7b79223a8ebeae8e953d3dfb30510e1479b67f3c5b0f`.
Evidence: `artifacts/pixel11-aosp-resident-apk-v1/signed-validation.json`.
The AOSP native helper still deliberately refuses resident executable files until
explicit system-file modes and complete runtime admission are implemented. The
new APK has not yet been staged into AOSP or run on Android.


### Resident system-app staging and explicit vendor overlay

The native staging helper now admits the full ARM64 resident runtime only when
its complete provenance matches the APK, Bun matches the pinned stable binary,
the Alpha source stamp matches the admitted source, and all worker files and the
extraction index verify. Asset and JNI copies must agree. The real signed APK
passed all 36 runtime entries and 1,114 worker entries. Twelve offline packaging
regressions pass, including self-consistent Bun substitution and corrupted
provenance/index rejection before modifying the overlay.

Generated `config.fs` gives Bun, the loader wrapper and real loader mode 0755;
shared libraries remain 0644. Every entry is root-owned with zero capabilities.
AOSP's filesystem-config generator accepted all ten entries, and the binary rules
were decoded and checked. Actual AOSP dumpvars selects
`vendor/alphaphone/config.fs`. This establishes build configuration, not final
image modes or executable loading. No SELinux permission exception was added.

The first fresh source audit correctly rejected the modified BoardConfig against
the original generated-vendor lock. `scripts/aosp-grizzly-contract.mjs` now derives
one explicit Alpha overlay: the preserved original must match the reference lock,
the current file must equal that exact original plus the owned policy, and every
other required artifact/text/file remains checked by the upstream assertion.
The upstream lock itself remains unchanged. Two regression cases verify rejection
of base drift, additional edits and ambiguous reference entries, and preservation
of unrelated requirements. The revised full audit passed all 1,087 projects and
both bound trees, recording the exact overlay. This development derivation does
not enroll a release key or grant deployment eligibility.

Full repository verification passed 270 tests, TypeScript and the web build.
The replacement AOSP build has started with build number
`alpha-grizzly-resident-dev`. Previous v3 target files were preserved at
`artifacts/pixel11-aosp-completed-v3/target-files.zip`, and the preserved SHA was
rechecked. The replacement build must finish and undergo image, boot and recovery
validation; the earlier image's results do not transfer automatically.

Evidence: `artifacts/pixel11-research/alpha-resident-build-started.json`,
`alpha-resident-runtime-admission.json`, `alpha-resident-fs-config-validation.json`,
`alpha-resident-product-resolved.log`, `alpha-build-inputs-resident-v2.json`, and
`verify-resident-aosp-contract.log` in the same research directory.


### Alpha read-only post-boot checker

The upstream post-boot adapter requires `/system/priv-app/Eliza/Eliza.apk`, its
package, HOME/ASSISTANT roles and authenticated health endpoint. Those assumptions
are not Alpha's product contract. `scripts/pixel11-postboot.mjs` instead checks an
explicit USB serial, grizzly SKU, exact Alpha fingerprint, slot, bootloader/radio,
SELinux enforcement, page size, `/product/app/AlphaPhone/AlphaPhone.apk`, and every
expected native file's hash, mode and owner. It observes HOME without changing it.
It does not reboot, install, unlock, select roles, start an agent or collect tokens.

Invocation, once a descriptor from the completed image and selected boot slot is
available:

```sh
npm run aosp:postboot -- --expected /absolute/path/to/expectation.json \
  --device PIXEL_SERIAL --adb /absolute/path/to/pinned/adb \
  --output /absolute/path/to/new-report.json
```

The expectation requires schema version 1, device `grizzly`, exact development
fingerprint, slot, page size, bootloader, baseband, APK SHA, ADB SHA and native-file
name/SHA/mode records. It is an inspection expectation, not a signed installation
authorization. The CLI refuses changed tools, duplicate/unknown options and
existing reports. Reports omit the raw serial, are owner-readable/writable only,
and explicitly keep agent execution, hardware acceptance, recovery and deployment
qualification false even when all image checks pass.

Five focused tests pass. Full repository verification passed 274 tests,
TypeScript and the web build; the subsequently added CLI preservation test also
passed in the focused run. A live SDK emulator was rejected with exit 2 before
package inspection. Separate read-only probes verified Android's sha256sum, stat
and role-query output formats on that emulator. No positive physical-device run
has occurred. Evidence is recorded under `alphaPostBootChecker` in the JSON ledger.

### OEM recovery script review

The three scripts inside the verified B1 factory archive were inspected without
executing them. Both `flash-all` variants write the bootloader, reboot it, write
the radio, reboot again, then run a wiping OS update. `flash-base.sh` performs the
firmware portion only. These are substantive firmware/data operations, not a
harmless fallback after an interrupted custom image install.

The supplied scripts resolve fastboot through PATH, do not select a serial and
do not stop explicitly when an individual flashing command fails. Their fixed
five-second waits do not verify a successful mode transition or device identity.
Recovery execution therefore needs the same pinned tool, explicit physical
serial, prevalidated firmware/rollback baseline, journal and stop-on-error
discipline as installation. Do not launch these raw scripts unattended or infer
that archive verification proves restoration. None of them relocks the device.

`artifacts/pixel11-research/google-factory-script-review.json` preserves all three
script contents and hashes, the current host tool hashes and the findings. The
current host tools report platform-tools 37.0.1-15733141. A physical restoration
remains untested; the latest USB check still exposes only two virtual devices.

### Resident product-image validation preparation

A local audit runner, `artifacts/pixel11-research/validate-resident-product.py`,
checks a completed product image through full EROFS extraction into a fresh
directory, preserves image permission bits, compares the APK and every ARM64
native file against the resident staging contract, verifies APK signing and
16 KiB ZIP alignment, and re-runs the resident provenance/source/Bun/workflow
checks on the APK extracted from the image. It does not infer image ownership
from files extracted as the host user, and it never reports deployment or
physical execution as verified.

The preserved v3 product image served as a real negative control. Its SHA matched
the earlier image ledger; EROFS, APK signature and alignment checks passed, and
the four older shared libraries matched. The resident check correctly rejected
the old APK and all six absent runtime libraries. The report is
`artifacts/pixel11-research/resident-product-negative-v3/report.json`. This is a
rejection test only; the replacement image has not finished building or passed
this audit yet.

### Completed resident image: checks and packaging rejection

The resident build subsequently succeeded. Its preserved target-files archive is
`artifacts/pixel11-aosp-completed-resident-v1/target-files.zip` (4,156,791,621 bytes,
SHA-256 `53a82320b6dbc140c8e301c796c7204ed7655cbce563c115e8d3b8c9775a3726`).
All 7,659 ZIP entries passed CRC checks with no duplicate names. The product-image
audit passed: the extracted APK and ten native files match the staged resident
contract, including runtime provenance. Direct EROFS inode inspection confirmed
root/root ownership and the intended permissions on all eleven files.

All six logical EROFS images passed extraction/integrity checks. AVB verified the
development test-key root and twelve covered images. The actual kernel and DTB
match the verified stock components. The built vendor boot command line contains
the stock KASAN/allocation settings and one `bootconfig`, with no MTE force-on or
KASAN panic flag. VINTF reports compatibility, and all 127 inspected VINTF/APEX
inputs match the actual images; its kernel FCM 202504 versus manifest 202604
warning remains. The source audit passed all 1,087 projects and two bound trees.

**This archive is rejected for deployment.** Its Android properties use the new
`alpha-grizzly-resident-dev` build number, while cached `misc_info.txt` and AVB
fingerprint properties retain `alpha-grizzly-dev`. Successful cryptographic
verification does not resolve this identity inconsistency. The pinned Make rule
for `misc_info.txt` has no fingerprint-file prerequisite. AOSP `m installclean`
followed by `m -j4 target-files-package` has been started with the same resident
build number to regenerate installed images and packaging metadata from compiled
outputs. The inconsistent archive and its audit evidence remain preserved.

The clean repackage log is
`artifacts/pixel11-research/alpha-grizzly-resident-clean-repackage-v2.log`.
The ledger's `residentCompletedImageV1` field links each completed check; none is
a physical boot, restore drill or release qualification. No physical Pixel is
currently visible in ADB or fastboot, and no phone writes have occurred.

### Clean resident candidate v2 and OS flash package

AOSP install-clean and repackaging succeeded. All twelve AVB fingerprint
properties now match the corresponding Android build properties; the product
fingerprint is
`Alpha/alpha_grizzly_phone/grizzly:17/CP2A.260605.016/alpha-grizzly-resident-dev:userdebug/test-keys`.
The preserved target-files ZIP has SHA-256
`2d455d18652e94cce74f7a7e51f7805ba0c252b34fa6e97e4c238eacdac77e94`,
4,156,791,582 bytes and 7,659 CRC-verified entries.

The re-run checks pass for the test-key AVB root and covered images, exact
resident APK/runtime payload, all eleven app/native inodes, six logical EROFS
filesystems, stock kernel/DTB, corrected boot command line and first-stage
fstabs. VINTF reports compatibility and its 127 VINTF/APEX inputs match the
actual images. Its kernel-level warning remains; this does not qualify a
202604 kernel. Logical images total 2,391,588,864 bytes against the configured
10,733,223,936-byte group, and fixed images fit their configured sizes. Actual
phone geometry and rollback compatibility have not been observed. The AVB
rollback index remains 1780617600, below the pinned stock index 1788220800;
do not infer physical downgrade acceptance from host signature checks.

The pinned AOSP `img_from_target_files` tool created the OS-only update ZIP:

- Path: `artifacts/pixel11-aosp-completed-resident-v2/alpha-grizzly-resident-dev-os-only-img.zip`
- Size: 2,054,848,956 bytes
- SHA-256: `bad29a0b8d79b46c68855a3a0084b98f438f64f1b97ee9999caf0970b504889d`
- Contents: sixteen images plus exact `android-info.txt` and `fastboot-info.txt`;
  every entry passed CRC/hash comparison with the validated image set.

The generic packager initially also included RADIO entries from the target's A/B
inventory. The OS-only candidate explicitly excludes those 27 entries; it does
not authorize a modem or bootloader transition. Its included fastboot plan still
contains shared-super operations, an opposite-slot system write and conditional
userdata/metadata erasure. It is not an untouched-slot rollback arrangement, and
the ZIP's existence does not authorize an unattended `fastboot update`.

Current evidence is in `artifacts/pixel11-research/resident-final-images-v2/`
and the `residentCleanRepackageV2` ledger field. Read-only post-boot expectations
for slots A and B were generated from this exact image and passed schema
validation. They assume the pinned B1 bootloader/radio and must be selected only
after observing the real starting state and intended slot. No positive physical
post-boot run, resident-agent execution, restoration drill or hardware acceptance
has occurred. Development test keys must not be used to justify relocking.

### Physical-device diagnosis before installation

After the user entered Fastboot Mode, the host detected the physical grizzly on
USB port 5-1. It is unlocked, battery 86%, with the exact pinned B1 bootloader and
baseband, no pending snapshot update and matching fixed/super partition sizes.
The `sku` variable is unsupported, so no regional SKU observation is claimed.
Slot A was active and marked successful; B was not successful and had zero retry
count. A read-only fetch of A's vendor_boot exactly matches the verified Google
B1 factory image. The bootloader refuses fetching vbmeta, which was not bypassed.

Rebooting into stock fastbootd succeeded in about 28 seconds, establishing that
this recovery environment and USB data transport work. Its reported system and
vendor fingerprints are B1. Read-only logical-partition queries show system_a is
only 4,616,192 bytes and A's product, vendor, system_ext and both DLKM partitions
are zero-sized. This active slot cannot supply a complete normal Android boot.
Slot B has populated logical partitions, but their sizes differ from stock.
Its fetched vendor_boot identifies the older
`elizaOS/eliza_grizzly_phone/grizzly:17/CP2A.260605.016/eng.shawwa:userdebug/test-keys`
build, with MTE force-on, KASAN panic and duplicate bootconfig arguments. Those
are additional concerns, not proof of B's failure cause. B was not activated.

The phone was returned to bootloader fastboot. At this diagnostic stage, no
partition had been written or erased. The reviewed Alpha installation targets A, reconstructs shared logical
OS storage, writes the secondary system image to B and wipes userdata/metadata.
It preserves bootloader/modem firmware and leaves the bootloader unlocked. It
cannot promise an untouched fallback slot or retained user data. The exact
archive was rehashed before recording the proposal. The subsequent explicit
user instruction authorized erasure; physical recovery remains untested.

Evidence and the proposed operation are retained under
`artifacts/pixel11-device-observation-20261004/`, including `diagnosis.json`,
`logical-slot-layout.json`, `vendor_boot_b-fstabs.json` and
`proposed-alpha-install.json`. The original stock restore archive was rehashed successfully. Its inner OS
image ZIP is now prepared locally (15,282,113,293 bytes, SHA-256
`bd0defdad7199ae52f17a60dad833d7912c537dfce42dd12a95d223fab343d70`),
with all inner CRCs verified. The user then explicitly instructed “erase and flash”.


### Authorized physical Alpha installation (October 4)

The exact reviewed OS-only ZIP was rehashed and installed to slot A with explicit
serial selection, a same-device install lock, pre-write firmware/geometry checks,
`--disable-super-optimization --skip-reboot -w update`, and a durable journal.
The update returned exit code 0 after 109.100 seconds; every image write and both
userdata/metadata erases succeeded. Fastboot reported these filesystems as raw
and did not automatically format them; erasure is confirmed, formatting is not.
The image’s fstab declares both partitions formattable on boot.

Alpha fastbootd successfully booted during the update. Post-flash queries
confirmed slot A, no snapshot update, and unchanged B1 bootloader/baseband.
No relock or firmware update was performed. Normal reboot succeeded at
2026-10-04T19:24:39Z, but physical Android ADB had not appeared after five minutes.
Normal Android boot, graphics, resident-agent execution and hardware acceptance
are not verified. The absence of ADB alone does not identify the boot failure.
The original A/B observations above are historical; B is not an intact fallback
after the shared logical-partition update.

Evidence: `artifacts/pixel11-device-observation-20261004/alpha-fastboot-update.log`,
`alpha-install-journal.jsonl`, and `post-flash-fastboot-state.json`. The prepared
stock restoration ZIP remains available; no physical restore drill is claimed.


### Black-screen incident after installation (October 4, 19:45 UTC onward)

The user reported the Google logo was followed by a black, unresponsive screen.
USB port 5-1 now enumerates “Pixel 11 Pro Recovery”; SDK fastboot labels it
“ROM Recovery” with a different serial. Read-only `getvar all` reports
`boot-stage: dbl`, `next-boot-stage: gsa_bl1`, `is-last-boot-stage: no`,
`product: mbu`, `version-dbl: 15665922`, and `devkey-allow: no`. Normal
bootloader variables (firmware version, slot, unlock state) return unknown
variable. The user reports Power + Volume Down for 30 seconds remained black.
The user also reports no response to the subsequent 35-second Power-only
forced restart. USB still identifies ROM Recovery after both attempts.

This supersedes the earlier first-boot-pending status. Android boot failed to
verify, and the ordinary restoration path is currently unavailable. The cause
of the early-stage recovery state is not established; neither permanent damage
nor successful recoverability has been demonstrated. No further partition
writes have been attempted. Read-only evidence is preserved in
`rom-recovery-observation.json`, `rom-recovery-variables.json`, and
`rom-recovery-getvar-all.json` under the device-observation artifact directory.

A single `reboot bootloader` request at 19:47:58 UTC was rejected with
“Unknown command” (exit 1); no partition writes were attempted. Evidence:
`rom-recovery-reboot-bootloader.json`.
