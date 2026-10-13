// The otpauth:// URI that authenticator apps read from the QR code. Kept free
// of dependencies because the enrollment screen also builds it in the browser
// (to rename the entry without sending the name to the server).

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

// Authenticator apps show entries as "<issuer>: <account name>".
export const TOTP_ISSUER = "YOSUGA";

export function otpauthUri(base32Secret: string, accountName: string, issuer = TOTP_ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}
