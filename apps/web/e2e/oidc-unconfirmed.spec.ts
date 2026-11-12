import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { encrypt, loadDataKey } from "shared";
import { userWhere, withPrisma } from "./db";
import { startMockIdp } from "./mock-idp";

// An account registered through an invitation without an address has the
// address its registrant typed in, unconfirmed. Single sign-on, which shows
// the address is the person's, links to it as theirs alone: every way in set
// up before goes (lib/auth/oidc.ts).
test("single sign-on to an account with an unconfirmed address takes over every way in", async ({ browser, baseURL }) => {
  const stamp = Date.now();
  const email = `e2e-unconfirmed-${stamp}@example.com`;
  const password = `E2e-unconfirmed-${stamp}`;
  const idp = await startMockIdp(`e2e-unconfirmed-${stamp}`);
  idp.idToken = { email, email_verified: true, name: "E2E 未確認" };
  idp.userInfo = { email, email_verified: true, name: "E2E 未確認" };
  const token = randomBytes(32).toString("base64url");
  const previous = await withPrisma(async (prisma) => {
    const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { publicUrl: true } });
    const oidc = await prisma.oidcSettings.findUnique({ where: { id: 1 } });
    await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl: new URL(baseURL!).origin } });
    const secret = Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(idp.clientSecret, "utf8"), "knowlective:oidc-client-secret"));
    const settings = { enabled: true, issuer: idp.issuer, clientId: idp.clientId, clientSecretEnc: secret, buttonLabel: "E2E IdP", trustEmail: false, allowedDomains: [], passwordLogin: "ALLOWED" as const };
    await prisma.oidcSettings.upsert({ where: { id: 1 }, create: { id: 1, ...settings }, update: settings });
    await prisma.invitation.create({
      data: { tokenHash: createHash("sha256").update(token).digest("hex"), siteRole: "USER", expiresAt: new Date(Date.now() + 3600_000) },
    });
    return { publicUrl: config.publicUrl, oidc };
  });
  try {
    // Registered through the invitation without an address.
    const first = await browser.newContext();
    const register = await first.newPage();
    await register.goto(`invite/${token}`);
    await register.getByTestId("RegisterForm.emailInput").fill(email);
    await register.getByTestId("RegisterForm.nameInput").fill("E2E 登録");
    await register.getByTestId("RegisterForm.passwordInput").fill(password);
    await register.getByTestId("RegisterForm.confirmPasswordInput").fill(password);
    await register.getByTestId("RegisterForm.submitButton").click();
    await register.waitForURL((url) => !url.pathname.includes("/invite/"));
    const before = await withPrisma(async (prisma) => prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, email), select: { id: true, emailUnconfirmed: true } }));
    expect(before.emailUnconfirmed).toBe(true);

    // The address's owner signs in through the IdP: the same account, now theirs.
    const sso = await browser.newContext();
    const ssoPage = await sso.newPage();
    await ssoPage.goto("auth/oidc/start?next=/account");
    await expect(ssoPage).toHaveURL(/\/account$/);
    const after = await withPrisma(async (prisma) =>
      prisma.user.findUniqueOrThrow({ where: { id: before.id }, select: { emailUnconfirmed: true, oidcSubject: true, _count: { select: { sessions: true } } } }),
    );
    expect(after.emailUnconfirmed).toBe(false);
    expect(after.oidcSubject).toBe(`e2e-unconfirmed-${stamp}`);
    await sso.close();

    // The registrant's session ended, and the password no longer signs in.
    await register.goto("account");
    await expect(register).toHaveURL(/\/login/);
    await register.getByTestId("LoginForm.emailInput").fill(email);
    await register.getByTestId("LoginForm.passwordInput").fill(password);
    await register.getByTestId("LoginForm.submitButton").click();
    await expect(register.getByTestId("LoginForm.error")).toBeVisible();
    await first.close();
  } finally {
    await withPrisma(async (prisma) => {
      await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl: previous.publicUrl } });
      if (previous.oidc) {
        const rest: Record<string, unknown> = { ...previous.oidc };
        delete rest.id;
        await prisma.oidcSettings.update({ where: { id: 1 }, data: rest as never });
      } else await prisma.oidcSettings.deleteMany({});
      const user = await prisma.user.findUnique({ where: await userWhere(prisma, email), select: { id: true } });
      if (user) await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    });
    await idp.close();
  }
});
