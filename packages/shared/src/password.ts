import { randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_KDF_PARAMS, KEY_LENGTH, deriveKeyFromPassword } from "./crypto";

// User password hashing with scrypt. Stored format (self-describing so the
// cost can be raised later without invalidating existing hashes):
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 1024;

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_KDF_PARAMS;
  const salt = randomBytes(16);
  const hash = await deriveKeyFromPassword(password, salt, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await deriveKeyFromPassword(password, salt, { N, r, p });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

// Burns the same scrypt cost as a real check, so "no such user" and "wrong
// password" take the same time and can't be told apart.
export async function verifyPasswordAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
  return false;
}
