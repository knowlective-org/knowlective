// Text locked with a passphrase, for the masked block (components/editor/
// masked-block.tsx) and masked columns of child page tables (masked-cell.tsx). Encrypted and decrypted in the browser only: the page
// document (and so the server, its database, the history and every viewer)
// holds just the sealed string. Dependency-free (Web Crypto), so it runs in
// Node for the unit tests too.
//
// Sealed format: "v1.<iterations>.<salt>.<iv>.<ciphertext>", base64url parts.
// PBKDF2-SHA-256 turns the passphrase and the salt into an AES-256-GCM key.
// A forgotten passphrase can't be recovered: nothing else can open it.

const VERSION = "v1";
export const PBKDF2_ITERATIONS = 600_000;
// Fewer than this in a sealed string (which comes from the shared document,
// so anyone who can edit the page can write it) isn't accepted.
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
export const MAX_SECRET_LENGTH = 20_000;
// Binds the ciphertext to its purpose.
const AAD = new TextEncoder().encode("knowlective-masked-text-v1");

export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase");
  }
}

// Web Crypto exists only in secure contexts (https, or localhost).
export function secretTextSupported(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

type Parsed = { iterations: number; salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> };

// Null for anything that isn't a well-formed sealed string.
export function parseSealed(sealed: string): Parsed | null {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION || !/^\d{1,8}$/.test(parts[1])) return null;
  const iterations = Number(parts[1]);
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  try {
    const [salt, iv, data] = parts.slice(2).map(fromBase64Url);
    // 16-byte salt, 12-byte nonce, and at least the 16-byte tag.
    if (salt.length !== 16 || iv.length !== 12 || data.length < 16) return null;
    return { iterations, salt, iv, data };
  } catch {
    return null;
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function sealWithKey(text: string, key: CryptoKey, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, new TextEncoder().encode(text)),
  );
  return [VERSION, String(iterations), toBase64Url(salt), toBase64Url(iv), toBase64Url(data)].join(".");
}

// A new salt and nonce every time, so sealing the same text twice differs.
export async function sealText(text: string, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return sealWithKey(text, await deriveKey(passphrase, salt, iterations), salt, iterations);
}

async function openWithKey(parsed: Parsed, key: CryptoKey): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: parsed.iv, additionalData: AAD }, key, parsed.data);
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPassphraseError();
  }
}

// Throws WrongPassphraseError when the passphrase doesn't open it (or the
// sealed string was altered), and a plain Error when it isn't one at all.
export async function openText(sealed: string, passphrase: string): Promise<string> {
  const parsed = parseSealed(sealed);
  if (!parsed) throw new Error("not a sealed text");
  return openWithKey(parsed, await deriveKey(passphrase, parsed.salt, parsed.iterations));
}

// Many texts under one passphrase (a masked column's values): each key is
// derived once per salt and kept, and new texts are sealed with the salt of
// the first one opened or sealed (a fresh nonce every time), so a column
// costs one key derivation, not one per value. The same sealed format.
export class SecretKeyring {
  readonly #passphrase: string;
  readonly #keys = new Map<string, Promise<CryptoKey>>();
  #sealing: { salt: Uint8Array<ArrayBuffer>; iterations: number } | null = null;

  constructor(passphrase: string) {
    this.#passphrase = passphrase;
  }

  #key(salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
    const id = `${iterations}.${toBase64Url(salt)}`;
    let key = this.#keys.get(id);
    if (!key) {
      key = deriveKey(this.#passphrase, salt, iterations);
      this.#keys.set(id, key);
    }
    this.#sealing ??= { salt, iterations };
    return key;
  }

  // Like openText().
  async open(sealed: string): Promise<string> {
    const parsed = parseSealed(sealed);
    if (!parsed) throw new Error("not a sealed text");
    return openWithKey(parsed, await this.#key(parsed.salt, parsed.iterations));
  }

  async seal(text: string): Promise<string> {
    const { salt, iterations } = this.#sealing ?? { salt: crypto.getRandomValues(new Uint8Array(16)), iterations: PBKDF2_ITERATIONS };
    return sealWithKey(text, await this.#key(salt, iterations), salt, iterations);
  }
}
