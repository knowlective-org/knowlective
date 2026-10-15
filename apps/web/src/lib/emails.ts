import { emailHash, loadDataKey, openEmail, sealEmail } from "shared";
import { prisma } from "@/lib/db";

// Email addresses are stored encrypted (shared/src/personal-data.ts): query
// by `emailHash`, write both columns, select `emailEnc` and open it here.

// `where` for "the row with this address".
export async function emailWhere(email: string) {
  return { emailHash: emailHash(await loadDataKey(prisma), email) };
}

// `data` for storing an address.
export async function emailColumns(email: string) {
  return sealEmail(await loadDataKey(prisma), email);
}

type Sealed = { emailEnc: Uint8Array | null };
type Opened<T extends Sealed> = Omit<T, "emailEnc"> & { email: string };

// The row with its address opened ("" for an account without one: the
// seed's demo user).
export async function withEmail<T extends Sealed>(row: T): Promise<Opened<T>> {
  const [opened] = await withEmails([row]);
  return opened;
}

export async function withEmails<T extends Sealed>(rows: T[]): Promise<Opened<T>[]> {
  if (rows.length === 0) return [];
  const key = await loadDataKey(prisma);
  return rows.map(({ emailEnc, ...rest }) => ({ ...rest, email: emailEnc ? openEmail(key, emailEnc) : "" }));
}

// What to call a user: their name, or their address when they have none.
export async function displayName(user: { name: string | null; emailEnc: Uint8Array | null }): Promise<string> {
  return user.name || (await withEmail(user)).email;
}

// An address that may be absent (an invitation for anyone, a master
// password login attempt).
export async function openOptionalEmail(emailEnc: Uint8Array | null): Promise<string | null> {
  return emailEnc ? openEmail(await loadDataKey(prisma), emailEnc) : null;
}
