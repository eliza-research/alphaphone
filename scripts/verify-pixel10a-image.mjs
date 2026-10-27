#!/usr/bin/env node
/**
 * Read-only checks of a booted alpha_stallion_phone image on a Pixel 10a through the shared
 * launcher image verifier: exact fingerprint, Alpha's nonprivileged system launcher bytes as
 * HOME, a remaining recovery HOME, Clock handlers, WebView, the verified boot state and, with
 * --listener, the Sense listener's privileges. Device facts only; no install or role change.
 *
 *   node scripts/verify-pixel10a-image.mjs --serial SERIAL --user 0 --descriptor LAUNCHER_JSON \
 *     --fingerprint EXACT --apk-path /product/app/AlphaPhone/AlphaPhone.apk --out NEW_REPORT [--listener]
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {main} from '../vendor/eliza/packages/os/scripts/android/verify-launcher-image.mjs';
import {validateExpectation} from './verify-cuttlefish-launcher.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2), {target: 'pixel10a', admitDescriptor: validateExpectation});
