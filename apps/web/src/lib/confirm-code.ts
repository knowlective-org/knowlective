// A short code shown in a dialog for the person to type back, as proof that
// an action is meant (unlocking a page). Not a secret: it's made in the
// browser and checked there. No dependencies.

// Crockford's Base32: no I, L, O or U, which are easily misread.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomConfirmCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 256 is a multiple of 32, so masking each byte stays uniform.
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
}

// What was typed, as Crockford's Base32 reads it: any case, with the
// look-alikes folded (O → 0, I and L → 1) and spaces and hyphens ignored.
export function normalizeConfirmCode(input: string): string {
  return input
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}
