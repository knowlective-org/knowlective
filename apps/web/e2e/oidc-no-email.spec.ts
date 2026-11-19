import { type Browser, expect, test } from "@playwright/test";
import { encrypt, loadDataKey } from "shared";
import { withPrisma } from "./db";
import { startMockIdp } from "./mock-idp";

// Single sign-on for people the identity provider has no email address for
// (OidcSettings.allowNoEmail, lib/auth/oidc.ts): refused unless allowed;
// allowed, an account is made without one, only while no domains are
// listed. An address that isn't verified isn't kept.
test("single sign-on without an email address: refused, or an account made without one when allowed", async ({ browser, baseURL }) => {
  const stamp = Date.now();
  const subjects = [`e2e-noemail-${stamp}`, `e2e-unverified-${stamp}`];
  const idp = await startMockIdp(subjects[0]);
  const as = (sub: string, claims: Record<string, unknown>) => {
    idp.idToken = { sub, ...claims };
    idp.userInfo = { sub };
  };
  const setOidc = (data: { allowNoEmail: boolean; allowedDomains: string[] }) =>
    withPrisma((prisma) => prisma.oidcSettings.update({ where: { id: 1 }, data }));
  const previous = await withPrisma(async (prisma) => {
    const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { publicUrl: true } });
    const oidc = await prisma.oidcSettings.findUnique({ where: { id: 1 } });
    // The callback must come back to the address the test uses (its cookie).
    await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl: new URL(baseURL!).origin } });
    const secret = Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(idp.clientSecret, "utf8"), "knowlective:oidc-client-secret"));
    const settings = {
      enabled: true,
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecretEnc: secret,
      buttonLabel: "E2E IdP",
      nameClaim: null,
      syncName: true,
      groupsClaim: null,
      trustEmail: false,
      allowNoEmail: false,
      allowedDomains: [],
      passwordLogin: "ALLOWED" as const,
    };
    await prisma.oidcSettings.upsert({ where: { id: 1 }, create: { id: 1, ...settings }, update: settings });
    return { publicUrl: config.publicUrl, oidc };
  });

  // Signs in through single sign-on in a fresh browser; where it ends up.
  const signIn = async (b: Browser) => {
    const context = await b.newContext();
    const page = await context.newPage();
    await page.goto("auth/oidc/start?next=/account");
    await page.waitForURL((url) => /\/(account|login)$/.test(url.pathname));
    return { context, page };
  };
  const account = (sub: string) =>
    withPrisma((prisma) => prisma.user.findFirst({ where: { oidcIssuer: idp.issuer, oidcSubject: sub }, select: { id: true, name: true, emailHash: true } }));

  try {
    as(subjects[0], { name: "E2E アドレスなし" });

    // Not allowed (the default): the login screen says why, no account made.
    let { context, page } = await signIn(browser);
    await expect(page).toHaveURL(/sso_error=no_email/);
    await expect(page.getByTestId("LoginPage.ssoError")).toBeVisible();
    await context.close();
    expect(await account(subjects[0])).toBeNull();

    // Allowed, but domains are listed: they can't be checked, still refused.
    await setOidc({ allowNoEmail: true, allowedDomains: ["example.com"] });
    ({ context, page } = await signIn(browser));
    await expect(page).toHaveURL(/sso_error=no_email/);
    await context.close();
    expect(await account(subjects[0])).toBeNull();

    // Allowed, any domain: an account without an address.
    await setOidc({ allowNoEmail: true, allowedDomains: [] });
    ({ context, page } = await signIn(browser));
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("ProfileSection.name")).toHaveText("E2E アドレスなし");
    await expect(page.getByTestId("AccountPage.email")).toHaveText("未設定");
    expect(await account(subjects[0])).toMatchObject({ name: "E2E アドレスなし", emailHash: null });
    await context.close();
    // Signing in again: the same account.
    ({ context, page } = await signIn(browser));
    await expect(page).toHaveURL(/\/account$/);
    await context.close();
    expect(await withPrisma((prisma) => prisma.user.count({ where: { oidcIssuer: idp.issuer, oidcSubject: subjects[0] } }))).toBe(1);
    // Its creation is recorded without an address.
    const created = await withPrisma((prisma) => prisma.auditLog.count({ where: { action: "user.create.oidc", createdAt: { gte: new Date(stamp) } } }));
    expect(created).toBe(1);

    // An address that isn't verified: not kept. No name from the IdP: its subject.
    as(subjects[1], { email: `e2e-unverified-${stamp}@example.com`, email_verified: false });
    ({ context, page } = await signIn(browser));
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("AccountPage.email")).toHaveText("未設定");
    expect(await account(subjects[1])).toMatchObject({ name: subjects[1], emailHash: null });
    await context.close();
  } finally {
    await withPrisma(async (prisma) => {
      await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl: previous.publicUrl } });
      if (previous.oidc) {
        const rest: Record<string, unknown> = { ...previous.oidc };
        delete rest.id;
        await prisma.oidcSettings.update({ where: { id: 1 }, data: rest as never });
      } else await prisma.oidcSettings.deleteMany({});
      // The accounts made here can't be deleted yet (no account deletion): disabled.
      await prisma.user.updateMany({ where: { oidcIssuer: idp.issuer, oidcSubject: { in: subjects } }, data: { disabledAt: new Date(), oidcSubject: null, oidcIssuer: null } });
    });
    await idp.close();
  }
});
