/**
 * Named reasons a verify-apks release row may not be distributed.
 *
 * verify-apks decides `distributable`; this reads one recorded row back and names every
 * blocker, so a gate that refuses a release (pilot provisioning and update, AOSP staging,
 * head qualification) can say why. It is deliberately stricter than the flag: a row marked
 * distributable:true whose own recorded facts contradict it is still blocked, and a fact
 * that was never recorded counts as unresolved. An empty list is the only admissible answer.
 *
 * Open-source licences are never a blocker here (decision P-09): a row's `licenceFlags`
 * (copyleft, unknown, unverified, missing licence text) are a record, and are not read by this
 * function. The single licence item that can block is the separately named
 * `unresolved-font-licence` check for a proprietary font with no recorded licence, and only
 * while UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION (scripts/licence-policy.mjs) is true.
 *
 * @param {Record<string, any>} row one `results[]` entry with mode "release"
 * @param {{manifestTestMocks?: unknown, manifestRuntimeProfile?: unknown, admission?: {failures: string[], blockers: string[], signerMatches?: boolean}, releaseSigner?: Record<string, any>, image?: {platformCertificateSha256?: unknown}, fontLicenceBlocks?: boolean}} [options]
 *   admission defaults to the row's recorded releaseAdmission; pass a freshly computed one, or
 *   the current android/release-signer.json as releaseSigner (which recomputes it), to judge the
 *   row against the committed signer: an unset signer then always blocks, whatever was recorded.
 *   image, for a build that goes into an AOSP image, requires its reviewed platform certificate
 *   SHA-256; an unset or placeholder certificate blocks. fontLicenceBlocks defaults to the policy
 *   constant.
 * @returns {string[]}
 */
import { UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION } from "./licence-policy.mjs";
import { releaseAdmission } from "./build-android.mjs";

const FONT_CHECK = /^(unresolved-font-licence: |font licence check failed: )/;
const HEX64 = /^[0-9a-f]{64}$/;

export function releaseBlockers(row, { manifestTestMocks = false, manifestRuntimeProfile = "native", admission = row?.releaseAdmission, releaseSigner, image, fontLicenceBlocks = UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION } = {}) {
  const blockers = [];
  if (releaseSigner !== undefined) {
    try { admission = releaseAdmission(row, releaseSigner); }
    catch (error) { admission = { failures: [error.message], blockers: [], signerMatches: false }; }
  }
  if (image !== undefined && !HEX64.test(image?.platformCertificateSha256 ?? ""))
    blockers.push(`image platform certificate is ${JSON.stringify(image?.platformCertificateSha256 ?? null)}, not a reviewed release certificate`);
  if (manifestTestMocks !== false || row.testMocks !== false) blockers.push("test-mocks build");
  if (row.bundleAudit !== "passed") blockers.push("release did not pass the flag-off bundle audit");
  if (row.signed !== true) blockers.push("unsigned release");
  if (!admission) blockers.push("release signing admission was not recorded");
  else {
    blockers.push(...(admission.failures ?? []), ...(admission.blockers ?? []));
    if (row.signed === true && admission.signerMatches !== true && !(admission.failures?.length || admission.blockers?.length))
      blockers.push("release signer does not match android/release-signer.json");
  }
  if (row.runtime !== "PACKAGED") blockers.push(`unpackaged runtime (resident runtime ${row.runtime ?? "not recorded"})`);
  else if (row.runtimeNotices !== true) blockers.push("notices lack the packaged runtime");
  // On-device voice (libelizainference Paradee/ASR, android/voice-host/qualified-voice-host.json) is
  // the only speech route: a release without it has no local speech. A packaged bundle must match the
  // record byte for byte and the record must be qualified (device acceptance); bytes never qualify it.
  const voice = row.voiceHost;
  if (!voice || typeof voice !== "object" || Array.isArray(voice) || typeof voice.packaged !== "boolean")
    blockers.push("on-device voice admission was not recorded");
  // P-57: a Cloud release packages no local speech by design and needs no voice host.
  else if (!voice.packaged) { if (manifestRuntimeProfile !== "cloud") blockers.push("no on-device voice packaged (local speech would be unavailable)"); }
  else {
    const missing = [(!Array.isArray(voice.differences) || voice.differences.length) && "bytes differ from the voice-host record",
      voice.qualified !== true && "device qualification pending"].filter(Boolean);
    if (missing.length) blockers.push(`unqualified on-device voice (${missing.join(", ")})`);
  }
  // The font check must have been run and recorded. Its items block only under the policy constant,
  // and only the named font check counts: no other licence text in this field is a blocker.
  if (!Array.isArray(row.licenceBlockers)) blockers.push("font licence check was not recorded");
  else if (fontLicenceBlocks) blockers.push(...row.licenceBlockers.map(String).filter(item => FONT_CHECK.test(item)));
  const named = [...new Set(blockers)];
  if (row.distributable !== true && !named.length) named.push("verify-apks did not record this release as distributable");
  return named;
}
