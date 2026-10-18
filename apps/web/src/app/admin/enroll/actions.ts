"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import {
  assertIpAllowed,
  createAdminSession,
  decryptTotpSecret,
  endAdminSession,
  getAdminConfig,
  getAdminSession,
} from "@/lib/admin/auth";
import { getRequestContext } from "@/lib/request";
import { verifyTotp } from "@/lib/admin/totp";

export type EnrollState = { error?: string };

export async function confirmEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (!session || session.stage !== "ENROLL_TOTP" || !session.pendingTotp) {
    redirect("/admin/login");
  }

  const code = formData.get("code");
  const userId = session.userId;
  const secret = await decryptTotpSecret(session.pendingTotp, userId);
  const step = typeof code === "string" ? verifyTotp(secret, code, null) : null;
  secret.fill(0);
  if (step === null) {
    return { error: (await getTranslations("admin.enroll.errors"))("wrongCode") };
  }

  // Only the first enrollment wins; never overwrite an existing secret here.
  // Resetting a lost authenticator goes through `pnpm admin:recover`.
  const { count } = userId
    ? await prisma.user.updateMany({
        where: { id: userId, totpSecret: null },
        data: { totpSecret: session.pendingTotp, totpLastStep: step },
      })
    : await prisma.instanceConfig.updateMany({
        where: { id: 1, totpSecret: null },
        data: { totpSecret: session.pendingTotp, totpLastStep: step },
      });
  await endAdminSession();
  if (count !== 1) redirect("/admin/login");

  // Issue a fresh token for the fully authenticated session.
  await createAdminSession(ctx, "ACTIVE", { userId: userId ?? undefined });
  redirect("/admin");
}
