"use server";

import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit, userLabel } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  MAX_PASSKEY_NAME_LENGTH,
  beginRegistration,
  finishRegistration,
  listPasskeys,
  passkeyRequiredSetting,
} from "@/lib/auth/passkeys";
import { getSessionUser } from "@/lib/auth/session";

// The signed-in user's own passkeys: from the account screen, and from
// /passkey-setup while the site makes them register one (getSessionUser()
// accepts both). Removing one needs a full session, so it's account-only.

export async function beginPasskeyRegistration(): Promise<
  { options: PublicKeyCredentialCreationOptionsJSON } | { error: string }
> {
  const session = await getSessionUser();
  const t = await getTranslations("account.passkeys.errors");
  if (!session) return { error: t("signedOut") };
  return { options: await beginRegistration(session.user) };
}

export async function finishPasskeyRegistration(
  response: RegistrationResponseJSON,
  rawName: string,
): Promise<{ error?: string }> {
  const session = await getSessionUser();
  const t = await getTranslations("account.passkeys");
  if (!session) return { error: t("errors.signedOut") };
  const name = (typeof rawName === "string" ? rawName.replace(/\s+/g, " ").trim() : "") || t("defaultName");
  if (name.length > MAX_PASSKEY_NAME_LENGTH) {
    return { error: t("errors.nameTooLong", { max: MAX_PASSKEY_NAME_LENGTH }) };
  }
  const result = await finishRegistration(session.user, response, name);
  if ("error" in result) return { error: t(`errors.${result.error}`) };
  const audit = await auditTranslator();
  await recordAudit(
    { userId: session.user.id, label: userLabel(session.user) },
    "user.passkey.add",
    audit("audit.passkeyAdd", { name }),
    { passkeyId: result.id },
  );
  revalidatePath("/account");
  return {};
}

export async function removePasskey(passkeyId: string): Promise<{ error?: string }> {
  const session = await getSessionUser();
  const t = await getTranslations("account.passkeys.errors");
  if (!session) return { error: t("signedOut") };
  const passkeys = await listPasskeys(session.user.id);
  const passkey = passkeys.find((p) => p.id === passkeyId);
  if (!passkey) return { error: t("notFound") };
  // The last one, where the site requires them: it would only have to be
  // registered again right away.
  if (passkeys.length === 1 && !session.passkeyExempt && (await passkeyRequiredSetting())) {
    return { error: t("lastRequired") };
  }
  await prisma.userPasskey.deleteMany({ where: { id: passkeyId, userId: session.user.id } });
  const audit = await auditTranslator();
  await recordAudit(
    { userId: session.user.id, label: userLabel(session.user) },
    "user.passkey.remove",
    audit("audit.passkeyRemove", { name: passkey.name }),
    { passkeyId },
  );
  revalidatePath("/account");
  return {};
}
