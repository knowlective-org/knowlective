import { createHmac } from "node:crypto";
import path from "node:path";

// The accounts made by `pnpm e2e:seed` (packages/shared/scripts/e2e-seed.ts;
// keep the two in sync).

export const PASSWORD = "e2e-Password-2026";

export const ACCOUNTS = {
  // SITE_ADMIN, MANAGE on the E2E knowledge root.
  admin: { email: "e2e-admin@example.com", name: "E2E 管理者" },
  // EDIT.
  editor: { email: "e2e-editor@example.com", name: "E2E 編集者" },
  // VIEW.
  viewer: { email: "e2e-viewer@example.com", name: "E2E 閲覧者" },
  // In no group: can't see the test pages.
  outsider: { email: "e2e-outsider@example.com", name: "E2E 部外者" },
} as const;

export type Role = keyof typeof ACCOUNTS;

// A page in the E2E knowledge root that every test may add pages under.
export const HOME_PAGE_ID = "e2e-home";

// Where auth.setup.ts keeps each account's signed-in browser state.
export const authFile = (role: Role) => path.join(__dirname, ".auth", `${role}.json`);

const ADMIN_TOTP_SECRET = Buffer.from("e2e-totp-secret-1234", "utf8");

// The admin's current authenticator code (RFC 6238: SHA-1, 6 digits, 30 s).
export function adminTotpCode(now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const mac = createHmac("sha1", ADMIN_TOTP_SECRET).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}