"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, ensurePersonalRoot } from "shared";
import { prisma } from "@/lib/db";
import { emailColumns, emailWhere } from "@/lib/emails";
import {
  InvitationUnavailableError,
  consumeInvitation,
  findValidInvitation,
} from "@/lib/auth/invitations";
import { createUserSession, normalizeEmail, requireUser } from "@/lib/auth/session";
import { getSignupSettings, isDomainAllowed } from "@/lib/auth/signup";
import { getRequestContext } from "@/lib/request";

export type InviteState = { error?: string };



export async function register(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const t = await getTranslations();
  const token = formData.get("token");
  const rawEmail = formData.get("email");
  const name = formData.get("name");
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (
    typeof token !== "string" ||
    typeof rawEmail !== "string" ||
    typeof name !== "string" ||
    typeof password !== "string" ||
    typeof confirm !== "string"
  ) {
    return { error: t("common.errors.invalidInput") };
  }

  const invitation = await findValidInvitation(token);
  if (!invitation) return { error: t("invite.errors.unavailable") };
  let siteRole = invitation.siteRole;
  if (invitation.selfSignup) {
    const signup = await getSignupSettings();
    if (!signup.enabled || !isDomainAllowed(invitation.email ?? "", signup.allowedDomains)) {
      return { error: t("common.errors.signupClosed") };
    }
    // The role set now, not when the link was sent.
    siteRole = signup.siteRole;
  }

  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { error: t("common.errors.emailFormat") };
  if (invitation.email && invitation.email !== email) {
    return { error: t("invite.errors.otherAddress") };
  }
  if (name.trim() === "") return { error: t("invite.errors.nameRequired") };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: t("common.errors.passwordLength", { min: MIN_PASSWORD_LENGTH }) };
  }
  if (password !== confirm) return { error: t("common.errors.passwordMismatch") };

  if (await prisma.user.findUnique({ where: await emailWhere(email), select: { id: true } })) {
    return {
      error: t("invite.errors.emailTaken"),
    };
  }

  const passwordHash = await hashPassword(password);
  const emailData = await emailColumns(email);
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { ...emailData, name: name.trim(), passwordHash, siteRole },
      });
      await consumeInvitation(tx, invitation.id, user.id);
      // Every person's account comes with its own personal knowledge root.
      await ensurePersonalRoot(tx, user.id, t("account.personalRootTitle"));
      return user.id;
    });
  } catch (err) {
    if (err instanceof InvitationUnavailableError) return { error: t("invite.errors.unavailable") };
    // Unique violation: the same email registered concurrently.
    if ((err as { code?: string }).code === "P2002") {
      return { error: t("invite.errors.emailTakenNow") };
    }
    throw err;
  }

  await createUserSession(await getRequestContext(), userId, "PASSWORD");
  redirect("/");
}

// For a user who already has an account and is logged in.
export async function accept(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const t = await getTranslations();
  const token = formData.get("token");
  if (typeof token !== "string") return { error: t("common.errors.invalidInput") };
  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);

  const invitation = await findValidInvitation(token);
  // Self-signup links only create accounts; they carry no groups to join.
  if (!invitation || invitation.selfSignup) return { error: t("invite.errors.unavailable") };
  if (invitation.email && invitation.email !== user.email) {
    return { error: t("invite.errors.otherAddress") };
  }

  try {
    await prisma.$transaction((tx) => consumeInvitation(tx, invitation.id, user.id));
  } catch (err) {
    if (err instanceof InvitationUnavailableError) return { error: t("invite.errors.unavailable") };
    throw err;
  }
  redirect("/");
}
