import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TOTP_DIGITS, TOTP_STEP_SECONDS } from "./otpauth";

// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) — the parameters every
// authenticator app (Google Authenticator, 1Password, Authy, ...) supports.

const STEP_SECONDS = TOTP_STEP_SECONDS;
const DIGITS = TOTP_DIGITS;
// Accept the previous and next step too, to tolerate clock drift.
const WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function toBase32(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// Default name for the authenticator entry of the master password, which has
// no account to name it after (accounts default to their email address):
// 6 random characters of Crockford's Base32. Only shown in the authenticator
// app; never stored.
export function randomAuthenticatorName(): string {
  // 256 is a multiple of 32, so masking each byte stays uniform.
  return Array.from(randomBytes(6), (byte) => CROCKFORD_ALPHABET[byte & 31]).join("");
}

function hotp(secret: Uint8Array, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

// Returns the matched time step, or null. Steps at or before `lastUsedStep`
// are rejected so an observed code can't be replayed.
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  lastUsedStep: number | null,
  now = Date.now(),
): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const step = currentStep(now);
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const candidate = step + offset;
    if (lastUsedStep !== null && candidate <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, candidate));
    if (timingSafeEqual(expected, Buffer.from(normalized))) return candidate;
  }
  return null;
}
