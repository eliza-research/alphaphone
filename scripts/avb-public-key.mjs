/**
 * AVB public key metadata (avb_pkmd.bin / *.avbpubkey): the AvbRSAPublicKeyHeader that
 * `avbtool extract_public_key` writes, computed from an RSA modulus. Used to check that a public
 * key file and its metadata describe the same key, and by the release key ceremony.
 */
import { execFileSync } from "node:child_process";

function modInverse(value, modulus) {
  let [a, m, x0, x1] = [value % modulus, modulus, 0n, 1n];
  while (a > 1n) {
    const q = a / m;
    [a, m] = [m, a % m];
    [x0, x1] = [x1 - q * x0, x0];
  }
  return (x1 + modulus) % modulus;
}

function bigEndian(value, bytes) {
  const out = Buffer.alloc(bytes);
  for (let i = bytes - 1; i >= 0; i--) { out[i] = Number(value & 0xffn); value >>= 8n; }
  return out;
}

/** AvbRSAPublicKeyHeader for an RSA modulus: key bits, n0inv, modulus and r^2 mod n, big-endian. */
export function avbPublicKeyMetadata(modulus) {
  const n = typeof modulus === "bigint" ? modulus : BigInt(`0x${modulus}`);
  const bits = n.toString(2).length;
  const keyBits = 2 ** Math.ceil(Math.log2(bits));
  const b = 1n << 32n;
  const n0inv = b - modInverse(n % b, b);
  const rr = ((1n << BigInt(bits)) ** 2n) % n;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(keyBits, 0);
  header.writeUInt32BE(Number(n0inv), 4);
  return Buffer.concat([header, bigEndian(n, keyBits / 8), bigEndian(rr, keyBits / 8)]);
}

/** RSA modulus (hex) of a key file via openssl; `publicOnly` refuses to open a private key. */
export function rsaModulus(file, { publicOnly = false } = {}) {
  const run = extra => execFileSync("openssl", ["rsa", ...extra, "-in", file, "-modulus", "-noout"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const out = publicOnly ? run(["-pubin"]) : run([]);
  const match = /^Modulus=([0-9A-Fa-f]+)\s*$/m.exec(out);
  if (!match) throw new Error(`${file} has no RSA modulus`);
  return match[1];
}
