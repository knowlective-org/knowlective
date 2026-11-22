import { createHash, randomBytes } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, PASSWORD } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { startMockIdp } from "./mock-idp";

// An account tied to the IdP signs in through it, so that disabling someone
// at the IdP keeps them out (lib/auth/oidc.ts, signsInThroughIdpOnly()): not
// with a password, even one set before the account was tied.

async function passwordLogin(page: Page, email: string, password: string) {
  await page.goto("login");
  await page.getByTestId("LoginForm.emailInput").fill(email);
  await page.getByTestId("LoginForm.passwordInput").fill(password);
  await page.getByTestId("LoginForm.submitButton").click();
}

test("an account tied to the IdP doesn't sign in with its old password", async ({ browser }) => {
  const subject = `e2e-linked-${Date.now()}`;
  const where = await withPrisma((prisma) => userWhere(prisma, ACCOUNTS.outsider.email));
  await withPrisma((prisma) => prisma.user.update({ where, data: { oidcIssuer: "https://idp.example.invalid", oidcSubject: subject } }));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await passwordLogin(page, ACCOUNTS.outsider.email, PASSWORD);
    await expect(page.getByTestId("LoginForm.error")).toContainText("シングルサインオン");
    await expect(page).toHaveURL(/\/login/);
  } finally {
    await withPrisma((prisma) => prisma.user.update({ where, data: { oidcIssuer: null, oidcSubject: null } }));
    await context.close();
  }
});

test("single sign-on to an existing account (a confirmed address) ends its password", async ({ browser, baseURL }) => {
  const stamp = Date.now();
  const email = `e2e-linked-${stamp}@example.com`;
  const password = `E2e-linked-${stamp}`;
  const idp = await startMockIdp(`e2e-linked-${stamp}`);
  idp.idToken = { email, email_verified: true, name: "E2E 結び付け" };
  idp.userInfo = { email, email_verified: true, name: "E2E 結び付け" };
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
    // An account with a password (its address confirmed).
    const first = await browser.newContext();
    const register = await first.newPage();
    await register.goto(`invite/${token}`);
    await register.getByTestId("RegisterForm.emailInput").fill(email);
    await register.getByTestId("RegisterForm.nameInput").fill("E2E 結び付け");
    await register.getByTestId("RegisterForm.passwordInput").fill(password);
    await register.getByTestId("RegisterForm.confirmPasswordInput").fill(password);
    await register.getByTestId("RegisterForm.submitButton").click();
    await register.waitForURL((url) => !url.pathname.includes("/invite/"));
    await withPrisma(async (prisma) => prisma.user.update({ where: await userWhere(prisma, email), data: { emailUnconfirmed: false } }));
    await first.close();

    // Its first sign-in through the IdP ties it.
    const sso = await browser.newContext();
    const ssoPage = await sso.newPage();
    await ssoPage.goto("auth/oidc/start?next=/account");
    await expect(ssoPage).toHaveURL(/\/account$/);
    // Its passkeys confirm who it is, but don't log in.
    await expect(ssoPage.getByTestId("AccountPage.passkeySection")).toContainText("パスキーではログインできません");
    await sso.close();

    const again = await browser.newContext();
    const page = await again.newPage();
    await passwordLogin(page, email, password);
    await expect(page.getByTestId("LoginForm.error")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await again.close();
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
