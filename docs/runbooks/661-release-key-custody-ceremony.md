# #661 Release key custody, ceremony and enrollment (H-01, H-08, H-09)

Owner preparation for [issue #661](https://github.com/eliza-research/alphaphone/issues/661). This
runbook collects what the custodian, witness and release owner need for
[human actions](../human-actions.md) H-01, H-08 and H-09 in one place. It is not evidence and
changes no record. No agent has seen, generated or handled any release key material; nobody
should paste keys, passphrases or PINs into an issue, PR, chat or commit.

Sources: [human actions](../human-actions.md) H-01/H-08/H-09, the pinned upstream
`vendor/eliza/packages/os/android/signing/README.md` (the offline ceremony), P-16 in
[decisions](../decisions.md), `android/signing/alpha-key-manifest.json`,
`scripts/enroll-release-keys.mjs`, `scripts/sign-release-apks.mjs`,
`scripts/sign-aosp-release.mjs` and [Pixel 10a staging](../pixel10a-staging.md) (managed signing).

## Read-only state on 2026-10-28 (main 94676c82, Eliza pin 1f2a922f)

- `npm run human:status`:
  - H-01 `external` (recorded outside the repository; verify: the choice is in decisions.md and
    nothing in the repository holds key material).
  - H-08 `external` (verify: every private file ends in `.enc`; both people sign `fingerprints.json`).
  - H-09 `open`: **12 of 12 release digests unset** (`android/release-signer.json signerSha256`;
    `pixel10a-product.json` `signer.platformCertificateSha256`, `signer.releaseCertificates.{shared,
    media, networkstack, sdk_sandbox, bluetooth, nfc, apex}`, `avb.publicKeySha256`;
    `pixel10a-ota-channel.json` `otaCertificateSha256`, `avbPublicKeySha256`).
- `android/signing/alpha-key-manifest.json` lists 12 keys: the eleven image keys (`releasekey`,
  `platform`, `shared`, `media`, `networkstack`, `sdk_sandbox`, `bluetooth`, `nfc`, `apex`,
  `apex_payload`, `avb`) plus `alphaphone_app`. It holds names and parameters only.
- Existing tests, run locally on this branch (offline, throwaway keys only):
  - `node --test test/enroll-release-keys.test.mjs`: 6/6 pass, including "a test-key ceremony from
    the pinned generator is refused, also when its testKeys flag is edited" and "reused, debug,
    mismatched, missing and unexpected keys are refused before anything is written".
  - `node --test test/sign-release-apks.test.mjs test/aosp-release-signing.test.mjs test/human-actions.test.mjs test/pixel10a-gates.test.mjs`:
    all pass (39 tests together with the enrollment file).
  - Upstream ceremony toolchain at the pin, `node --test scripts/__tests__/release-key-ceremony.node.test.ts`
    from `vendor/eliza/packages/os`: 6/6 pass (AVB encoding vectors, encrypted-at-rest keys, product
    `--manifest`, unsafe output and weak passphrase refusals).

These are unit tests with throwaway keys. They show the refusals work; they are not a ceremony.

## Decisions for the owner

### D1 (H-01). Where do the release keys live after the ceremony?

P-16 requires "managed or hardware-backed release signing, distinct from developer keys" and names
no service. The documented default is **none**: H-01 is open and nothing is chosen by software.
In every option the offline encrypted ceremony output stays the authoritative backup.

| Option | What it is | What works today | What the choice changes |
| --- | --- | --- | --- |
| A. Encrypted key files, ephemeral signing job | The ceremony's `.enc` bundle is decrypted with `decrypt-release-keys.ts` into tmpfs (`/dev/shm/keys`) on an ephemeral, reviewed, no-external-IP machine for one job, then shredded | APKs: `sign-release-apks.mjs --keys-dir` (tested with a real apksigner on ceremony-layout files). Image/OTA: `sign-aosp-release.mjs --keys-dir` (mocked releasetools only) | Simplest; no new tooling. Keys exist in plaintext in RAM during each job, so job isolation and the passphrase split are the controls. **Owner must state in the P- entry how this satisfies P-16's "managed or hardware-backed"** (it is neither, strictly read). |
| B. Hardware security module with PKCS#11 (on-prem or USB/network HSM) | Keys imported into an HSM; signing tools call it through PKCS#11 | APKs: `sign-release-apks.mjs --pkcs11-config --key-label`, PIN via `ELIZAOS_PKCS11_PIN` only. Image/OTA managed mode needs `--pkcs11-config`, `--avb-signing-helper`, `--payload-signer`, `--payload-signer-signature-size` | Meets P-16 directly. **signapk opens the token without a PIN** ([staging guide](../pixel10a-staging.md#managed-hardware-backed-signing)), so an HSM that requires a user login makes every image key lookup fail; the token must expose keys without login, or image signing falls back to option A. The AVB signing helper and OTA payload signer are not in this repository and must be written and reviewed (the helper must overwrite its input file in place). |
| C. Managed key service with a PKCS#11 library (cloud KMS/HSM) | Offline keys imported into a managed service; its PKCS#11 library authenticates with the service's own credentials; audit logging on; only a release-signer identity may use them | Same tool paths as B. Upstream README section 2 describes this shape | Meets P-16; the "no login" constraint is satisfied by service-authenticated libraries. Needs: RSA-4096 import with SHA256withRSA, the helper and payload signer as in B, a stable key-directory path (token labels are `<key-dir real path>/<name>.pk8`), and per-signing cost/availability. No signing has ever run against a real token or service. |

Recommendation (agent, for the owner to accept or replace): decide B or C if P-16 is read
strictly; choose A only with an explicit P- entry saying it is accepted as P-16's "distinct from
developer keys" for the pilot and naming when B/C replaces it. A hybrid is allowed by the tools
per job (APK signing via PKCS#11, image signing with key files) but not within one image-signing
job: `sign-aosp-release.mjs` refuses to mix private key files and token keys.

Also decide and record: the **custodian**, the **witness**, the **two backup locations** (separate
sites, tamper-evident bags, passphrase halves stored apart from the drives), and the **legal entity**
string for `--organization`.

Note: `alpha-key-manifest.json` marks the `avb` key `storage: "hsm"` and every other key
`offline-encrypted`. If option A is chosen for AVB, that field should be corrected in the same
reviewed change as the P- entry (it is a label, not enforced by the generator).

### D2. Does the application key ever rotate?

`alphaphone_app` is `rotatable: "only through an APK signature scheme v3 rotation lineage"`; the
image keys are not rotatable on fielded devices without a wipe. Default: no rotation planned.
Choosing to plan for rotation changes nothing now, but the custody choice must keep the old key
usable to sign a lineage.

## Draft decision entries

Not committed to `docs/decisions.md`; for the owner to complete and add as one reviewed change.

```markdown
- **P-57 — H-01 / A-06 ([#661](https://github.com/eliza-research/alphaphone/issues/661)), decided <YYYY-MM-DD> by Shaw for Alpha Compute:**
  Release key custody is <A: encrypted key files decrypted only into tmpfs on an ephemeral reviewed
  signing machine | B: <HSM model> through PKCS#11 | C: <managed service> through its PKCS#11 library>.
  Ceremony custodian: <name/role>. Witness: <name/role>. Encrypted backups: <site 1>, <site 2>;
  passphrase halves stored separately from the drives. Legal entity for certificates: <entity>.
  <For A: "Accepted as P-16's 'distinct from developer keys' for the pilot; replaced by <B/C> before <milestone>.">
  <For B/C: "Token keys exposed to signapk without a user login: <how>; AVB signing helper and payload signer: <reviewed location>.">
  No key material, passphrase or PIN is recorded anywhere in this repository. This records custody
  policy only; it is not evidence that any key exists or that any release was signed.
```

(P-57 is the next free number on main at 94676c82; renumber if another entry lands first.)

## H-08 Ceremony (custodian + witness, offline)

Follow upstream `vendor/eliza/packages/os/android/signing/README.md` section 1 exactly; the steps
below bind it to Alpha's key list.

Materials: an air-gapped laptop booted from a verified live image with networking disabled; two
new encrypted USB drives; tamper-evident bags; a printer for `fingerprints.json`.

1. Copy this repository at a reviewed commit (with `vendor/eliza` at the `upstream.lock.json`
   pin) onto the laptop. Node 24 and OpenSSL 3. Run the toolchain check:
   `(cd vendor/eliza/packages/os && node --test scripts/__tests__/release-key-ceremony.node.test.ts)`.
2. Each person types half of the passphrase (at least 20 characters in total) into tmpfs:
   ```sh
   umask 077; mkdir -p /dev/shm/ceremony
   cat > /dev/shm/ceremony/pass   # both halves on one line, then Ctrl-D
   ```
3. Generate into a **new directory outside any Git working tree** (the generator refuses otherwise):
   ```sh
   node vendor/eliza/packages/os/scripts/android/generate-release-keys.ts \
     --manifest android/signing/alpha-key-manifest.json \
     --output /media/USB1/<new directory> \
     --passphrase-file /dev/shm/ceremony/pass --organization "<legal entity>"
   ```
   Never pass `--test-keys`: enrollment refuses its output (`testKeys:true`, `OU=TEST ONLY`).
4. Check every private file ends in `.enc` (`<name>.pk8.enc`, `<name>.pem.enc`) and that no
   plaintext `.pk8` or private `.pem` exists. Print `fingerprints.json`; both people sign it.
5. Copy the directory to the second drive. Seal each drive and each passphrase half separately and
   store them at the two recorded locations.
6. If H-01 chose B or C: import the keys into the HSM/service from the offline bundle (the offline
   bundle stays authoritative), restrict use to the release-signer identity, enable audit logging.
7. `shred` `/dev/shm/ceremony` and power off.

Evidence kept off-repo: the signed `fingerprints.json` printout, the bag seal numbers, date and
both names. The repository receives only the H-09 enrollment commit.

## H-09 Enrollment (release owner, reviewed change)

1. Copy **only public files** from the ceremony media to the working machine: `fingerprints.json`,
   every `*.x509.pem`, and `avb_pkmd.bin`. Never the `.enc` files.
2. Dry run (writes nothing):
   ```sh
   node scripts/enroll-release-keys.mjs --fingerprints <copy>/fingerprints.json --certificates <copy>
   ```
   It refuses: a test-key ceremony, a key list different from `alpha-key-manifest.json`, one
   certificate under two names, a debug signing certificate (debug rows of
   `artifacts/apk-manifest.json` and any `--debug-fingerprint`), certificates that do not hash to
   `fingerprints.json`, and any change to an already recorded digest (without `--replace`).
3. Note the two printed application identities (public values, safe to share with the Cloud
   operator): the **SHA-1** for the Google Android OAuth client of `ai.elizaresearch.alphaphone`
   (H-12) and the **colon SHA-256** for `ELIZA_ANDROID_ASSET_LINKS_JSON` (H-13).
4. Write: the same command with `--write`. Review the diff (only digest lines change) and commit
   the three records together: `android/release-signer.json`, `android/aosp/pixel10a-product.json`,
   `android/aosp/pixel10a-ota-channel.json`.
5. **Separately** set `signer.platformCertificateSha256` in `android/aosp/product.json` (the
   Cuttlefish product) to the same `platform` certificate SHA-256: `enroll-release-keys.mjs` does
   not write that file, and Cuttlefish production staging (H-23) refuses while it is `UNSET`.
   `node scripts/owner/production-staging-preflight.mjs` lists it as `H-09 (manual)`.
6. `npm run human:status` must show H-09 `done`.

## Remaining human steps

1. Owner: choose D1 (A, B or C), name custodian, witness, backup sites and legal entity; add the
   P- entry above to `docs/decisions.md` (H-01).
2. If B or C: provide the token configuration, and have a reviewed AVB signing helper and OTA
   payload signer ready before the first image signing (H-22).
3. Custodian and witness: run the H-08 ceremony offline.
4. Release owner: run the H-09 dry run, then `--write`, commit the three records, and add the
   `product.json` platform digest in a reviewed change.
5. Cloud operator (after step 4): H-12 (Android OAuth client with the printed SHA-1) and H-13
   (assetlinks with the printed SHA-256).
