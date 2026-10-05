import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_KDF_PARAMS,
  type KdfParams,
  decrypt,
  deriveKeyFromPassword,
  encrypt,
  generateKey,
  parseServerKey,
} from "./crypto";
import { normalizePublicUrl } from "./public-url";

// Instance-level setup: the master password and the data encryption key (DEK).
// See crypto.ts for the envelope encryption scheme.

const INSTANCE_ID = 1;
const AAD_BY_PASSWORD = "yosuga:dek:master-password";
const AAD_BY_SERVER_KEY = "yosuga:dek:server-key";

export const MIN_MASTER_PASSWORD_LENGTH = 12;

export class InstanceNotSetUpError extends Error {
  constructor() {
    super("Instance setup has not been completed yet");
  }
}

export class InstanceAlreadySetUpError extends Error {
  constructor() {
    super("Instance setup has already been completed");
  }
}

export async function isSetupComplete(prisma: PrismaClient): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({
    where: { id: INSTANCE_ID },
    select: { id: true },
  });
  return config !== null;
}

// Sets the master password and generates the DEK. Can only succeed once per
// instance; a concurrent second call fails on the primary key constraint.
export async function setupInstance(
  prisma: PrismaClient,
  masterPassword: string,
  publicUrl: string,
): Promise<void> {
  if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(`Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`);
  }
  const origin = normalizePublicUrl(publicUrl);
  // Fail before generating anything if the server key is missing or malformed.
  const serverKey = parseServerKey();

  const dek = generateKey();
  const kdfSalt = randomBytes(16);
  const passwordKey = await deriveKeyFromPassword(masterPassword, kdfSalt, DEFAULT_KDF_PARAMS);

  try {
    await prisma.instanceConfig.create({
      data: {
        id: INSTANCE_ID,
        publicUrl: origin,
        kdfSalt: Uint8Array.from(kdfSalt),
        kdfParams: DEFAULT_KDF_PARAMS,
        dekByPassword: Uint8Array.from(encrypt(passwordKey, dek, AAD_BY_PASSWORD)),
        dekByServerKey: Uint8Array.from(encrypt(serverKey, dek, AAD_BY_SERVER_KEY)),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new InstanceAlreadySetUpError();
    throw err;
  } finally {
    dek.fill(0);
    passwordKey.fill(0);
  }
}

// The master password is correct iff it can unwrap the DEK (AES-GCM verifies
// the auth tag), so no separate password hash is stored.
export async function verifyMasterPassword(
  prisma: PrismaClient,
  masterPassword: string,
): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
  if (!config) throw new InstanceNotSetUpError();
  const passwordKey = await deriveKeyFromPassword(
    masterPassword,
    config.kdfSalt,
    config.kdfParams as KdfParams,
  );
  try {
    decrypt(passwordKey, config.dekByPassword, AAD_BY_PASSWORD).fill(0);
    return true;
  } catch {
    return false;
  } finally {
    passwordKey.fill(0);
  }
}

// Re-wraps the DEK with a new server key, using the master password to
// unwrap it. For when YOSUGA_SERVER_KEY is lost, leaked, or being rotated.
// Page data itself is untouched, since the DEK doesn't change.
export async function rewrapWithServerKey(
  prisma: PrismaClient,
  masterPassword: string,
  newServerKey: Buffer,
): Promise<void> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
  if (!config) throw new InstanceNotSetUpError();
  const passwordKey = await deriveKeyFromPassword(
    masterPassword,
    config.kdfSalt,
    config.kdfParams as KdfParams,
  );
  let dek: Buffer;
  try {
    dek = decrypt(passwordKey, config.dekByPassword, AAD_BY_PASSWORD);
  } catch {
    throw new Error("Master password is incorrect");
  } finally {
    passwordKey.fill(0);
  }
  try {
    await prisma.instanceConfig.update({
      where: { id: INSTANCE_ID },
      data: { dekByServerKey: Uint8Array.from(encrypt(newServerKey, dek, AAD_BY_SERVER_KEY)) },
    });
  } finally {
    dek.fill(0);
  }
}

let cachedDataKey: Buffer | null = null;

// Returns the DEK, unwrapped with YOSUGA_SERVER_KEY. Cached for the lifetime
// of the process once setup has completed.
export async function loadDataKey(prisma: PrismaClient): Promise<Buffer> {
  if (cachedDataKey) return cachedDataKey;
  const config = await prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
  if (!config) throw new InstanceNotSetUpError();
  const serverKey = parseServerKey();
  try {
    cachedDataKey = decrypt(serverKey, config.dekByServerKey, AAD_BY_SERVER_KEY);
  } catch (err) {
    throw new Error(
      "Failed to unlock the data encryption key. YOSUGA_SERVER_KEY does not match the key used at setup.",
      { cause: err },
    );
  }
  return cachedDataKey;
}
