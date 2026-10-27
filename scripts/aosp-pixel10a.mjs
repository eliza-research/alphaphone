import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {composePixel10aProduct} from '../vendor/eliza/packages/os/scripts/android/pixel10a-product.ts';

/** The production descriptor for Pixel 10a (stallion) on Android 17. */
export const PIXEL10A_PRODUCT = 'android/aosp/pixel10a-product.json';
export const PIXEL10A_COMPOSITION = 'vendor/eliza/packages/os/android/products/pixel10a-alpha.json';
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** JSON paths whose string value is unset or a placeholder (descriptions excluded). */
export function placeholderFields(value, at = '') {
  if (typeof value === 'string') return /^(unset|todo|tbd)$/i.test(value.trim()) || /placeholder/i.test(value) ? [at || '(value)'] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => placeholderFields(item, `${at}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => key !== 'description').flatMap(([key, item]) => placeholderFields(item, at ? `${at}.${key}` : key));
  return [];
}

/**
 * Whether this run stages the physical Pixel 10a product. Development staging needs the exact
 * source and factory inputs; production staging additionally needs the reviewed launcher
 * descriptor (checked by stage-aosp) and a complete production descriptor (pixel10aProductProblems).
 */
export function pixel10aOptions({target, development, production, source, factory}) {
  if (target != null && target !== 'pixel10a') throw Error('Only --target pixel10a is supported; omit --target for the existing product');
  if (!target) {
    if (factory) throw Error('--factory-image requires --target pixel10a');
    return false;
  }
  if (development && production) throw Error('--production and --development are exclusive');
  if (!development && !production) throw Error('Pixel 10a staging needs --development or --production');
  if (!source || !factory) throw Error('Pixel 10a staging requires --aosp-source and --factory-image');
  return true;
}

/**
 * Problems that keep alpha_stallion_phone from production staging, read from `root`: the
 * production descriptor, its pinned source lock, the APK release signer and the image platform
 * certificate. An empty list admits staging inputs only; it is never an image build, signed
 * image, boot, device or release qualification.
 */
export function pixel10aProductProblems(root = process.cwd()) {
  const at = rel => path.join(root, rel);
  if (!fs.existsSync(at(PIXEL10A_PRODUCT))) return [`${PIXEL10A_PRODUCT} is missing`];
  let product;
  try { product = JSON.parse(fs.readFileSync(at(PIXEL10A_PRODUCT), 'utf8')); } catch (error) { return [`${PIXEL10A_PRODUCT} is unreadable: ${error.message}`]; }
  const problems = [];
  if (product.schema !== 1) problems.push(`${PIXEL10A_PRODUCT}: schema must be 1`);
  for (const field of placeholderFields(product)) problems.push(`${PIXEL10A_PRODUCT}: ${field} is unset or a placeholder`);
  if (product.product !== 'alpha_stallion_phone' || product.target !== 'pixel10a') problems.push(`${PIXEL10A_PRODUCT}: product must be alpha_stallion_phone for target pixel10a`);
  if (product.device?.codename !== 'stallion' || product.device?.androidRelease !== '17') problems.push(`${PIXEL10A_PRODUCT}: device must be stallion on Android 17`);
  if (!/^alpha_stallion_phone-[a-z0-9]+-user$/.test(product.lunch?.production ?? '')) problems.push(`${PIXEL10A_PRODUCT}: lunch.production must be a user build of alpha_stallion_phone`);
  // Software never records release qualification or device acceptance.
  if (product.releaseQualified !== false) problems.push(`${PIXEL10A_PRODUCT}: releaseQualified must stay false; it is release evidence, not a staging input`);
  if (product.deviceAcceptanceVerified !== false) problems.push(`${PIXEL10A_PRODUCT}: deviceAcceptanceVerified must stay false; it is device evidence, not a staging input`);
  // The pinned source lock: exact bytes, the stallion Android 17 contract, admitted for release.
  const lockFile = product.sourceLock?.file;
  if (lockFile !== 'vendor/eliza/packages/os/android/sources/pixel10a-stallion.json' || !fs.existsSync(at(lockFile))) problems.push(`${PIXEL10A_PRODUCT}: sourceLock.file must be vendor/eliza/packages/os/android/sources/pixel10a-stallion.json`);
  else {
    const bytes = fs.readFileSync(at(lockFile));
    if (!HEX64.test(product.sourceLock.sha256 ?? '')) problems.push(`${PIXEL10A_PRODUCT}: sourceLock.sha256 must pin the reviewed source lock`);
    else if (sha256(bytes) !== product.sourceLock.sha256) problems.push(`${lockFile} differs from the pinned sourceLock.sha256`);
    let lock = null;
    try { lock = JSON.parse(bytes); } catch { problems.push(`${lockFile} is unreadable`); }
    if (lock) {
      if (lock.target !== 'pixel10a' || lock.device?.codename !== 'stallion' || lock.device?.androidRelease !== '17') problems.push(`${lockFile} is not the Pixel 10a Android 17 source contract`);
      if (lock.developmentOnly !== false) problems.push(`${lockFile} is still marked developmentOnly; admit its inputs for release in a reviewed change`);
      if (lock.releaseQualified !== false) problems.push(`${lockFile}: releaseQualified must stay false`);
    }
  }
  // The reviewed signer: the APK release signer descriptor and the image platform certificate.
  if (product.signer?.apkDescriptor !== 'android/release-signer.json') problems.push(`${PIXEL10A_PRODUCT}: signer.apkDescriptor must be android/release-signer.json`);
  else {
    let signer;
    try { signer = JSON.parse(fs.readFileSync(at(product.signer.apkDescriptor), 'utf8')).signerSha256; } catch { signer = undefined; }
    if (!HEX64.test(signer ?? '')) problems.push(`android/release-signer.json signerSha256 is ${JSON.stringify(signer)}, not a reviewed release certificate`);
  }
  if (!HEX64.test(product.signer?.platformCertificateSha256 ?? '')) problems.push(`${PIXEL10A_PRODUCT}: signer.platformCertificateSha256 must be a SHA-256`);
  return [...new Set(problems)];
}

export function writePixel10aProduct({root, output, apk, identity, launcher, sourceEvidence, production = false}) {
  const nativeStagingEvidence = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/stage-aosp-native.py'), '--apk', path.resolve(apk), '--output', output, '--module', identity.moduleName, '--target', 'stallion'], {encoding:'utf8'}));
  const product = JSON.parse(fs.readFileSync(path.join(root, PIXEL10A_COMPOSITION), 'utf8'));
  const report = composePixel10aProduct({output, product, launcher, sourceEvidence, nativeStagingEvidence, production});
  if (production) {
    const bytes = fs.readFileSync(path.join(root, PIXEL10A_PRODUCT));
    const descriptor = JSON.parse(bytes);
    Object.assign(report, {productDescriptor:{file:PIXEL10A_PRODUCT, sha256:sha256(bytes)}, sourceLockSha256:descriptor.sourceLock.sha256, platformCertificateSha256:descriptor.signer.platformCertificateSha256});
    fs.writeFileSync(path.join(output, 'physical-product.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
