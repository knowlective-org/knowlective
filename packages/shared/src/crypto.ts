import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";

// Envelope encryption primitives.
//
// - DEK (data encryption key): random 256-bit key that encrypts page content.
// - The DEK is never stored in plaintext. It is stored twice, wrapped by:
//   1. a key derived from the instance master password (scrypt) — for recovery
//      and re-keying, and
//   2. the server key from the KNOWLECTIVE_SERVER_KEY env var — so processes can
//      unlock the DEK on startup without a human typing the master password.
//
// Ciphertext format (all AES-256-GCM): [version(1)] [iv(12)] [authTag(16)] [ciphertext]

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;
export const KEY_LENGTH = 32;

export function encrypt(key: Uint8Array, plaintext: Uint8Array, aad?: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

// Throws if the key is wrong, the data was tampered with, or `aad` doesn't
// match what was used at encryption time.
export function decrypt(key: Uint8Array, payload: Uint8Array, aad?: string): Buffer {
  const buf = Buffer.from(payload);
  if (buf.length < HEADER_LENGTH || buf[0] !== VERSION) {
    throw new Error("Unsupported or corrupted ciphertext");
  }
  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(1 + IV_LENGTH, HEADER_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(HEADER_LENGTH)), decipher.final()]);
}

export function generateKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

// scrypt cost parameters. Stored alongside the wrapped key so they can be
// raised later without breaking existing instances.
export type KdfParams = { N: number; r: number; p: number };
export const DEFAULT_KDF_PARAMS: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

export function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      // 128 * N * r bytes are required; leave headroom over Node's 32MB default.
      { ...params, maxmem: 256 * params.N * params.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export function parseServerKey(value = process.env.KNOWLECTIVE_SERVER_KEY): Buffer {
  if (!value) {
    throw new Error(
      "KNOWLECTIVE_SERVER_KEY is not set. Generate one with `pnpm gen:server-key` and add it to .env",
    );
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`KNOWLECTIVE_SERVER_KEY must be ${KEY_LENGTH} bytes, base64-encoded`);
  }
  return key;
}
