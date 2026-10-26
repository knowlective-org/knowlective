import { type Browser, expect, test } from "@playwright/test";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, HOME_PAGE_ID } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { editorBody, openPage } from "./helpers";
import { type MockIdp, startMockIdp } from "./mock-idp";

// Single sign-on through a stand-in identity provider (mock-idp.ts): the
// display name from a template of ID token and UserInfo claims, and groups
// from a claim, both again at every sign-in. The outsider account is linked
// to the stand-in for the test; everything is put back afterwards.

const SUBJECT = "e2e-sso-outsider";
const stamp = Date.now();
const SALES = `E2E SSO 営業 ${stamp}`;
const DEV = `E2E SSO 開発 ${stamp}`;
const MANUAL = `E2E SSO 手動 ${stamp}`;

let idp: MockIdp;
let previousOidc: Awaited<ReturnType<typeof readOidc>>;
let previousPublicUrl: string | null;
let outsiderId: string;

const readOidc = () => withPrisma((prisma) => prisma.oidcSettings.findUnique({ where: { id: 1 } }));

// Signs in through single sign-on in a fresh browser and lands on the account screen.
async function signInWithSso(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("auth/oidc/start?next=/account");
  await expect(page).toHaveURL(/\/account$/);
  return { context, page };
}

async function memberships() {
  return withPrisma((prisma) =>
    prisma.groupMember.findMany({
      where: { userId: outsiderId },
      select: { viaOidc: true, group: { select: { name: true, oidcCreated: true } } },
    }),
  );
}

// In any order (the database's collation decides it).
const sameMemberships = async (expected: Awaited<ReturnType<typeof memberships>>) => {
  const actual = await memberships();
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining(expected));
};

test.describe("Single sign-on profile", () => {
  test.beforeAll(async ({ baseURL }) => {
    idp = await startMockIdp(SUBJECT);
    previousOidc = await readOidc();
    await withPrisma(async (prisma) => {
      const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { publicUrl: true } });
      previousPublicUrl = config.publicUrl;
      // The callback must come back to the address the test uses (its cookie).
      await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl: new URL(baseURL!).origin } });
      const secret = Uint8Array.from(
        encrypt(await loadDataKey(prisma), Buffer.from(idp.clientSecret, "utf8"), "knowlective:oidc-client-secret"),
      );
      const settings = {
        enabled: true,
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecretEnc: secret,
        buttonLabel: "E2E IdP",
        nameClaim: "{family_name} {given_name}@{department}",
        syncName: true,
        groupsClaim: "groups",
        trustEmail: true,
        allowedDomains: [],
        passwordLogin: "ALLOWED" as const,
      };
      await prisma.oidcSettings.upsert({ where: { id: 1 }, create: { id: 1, ...settings }, update: settings });
      const outsider = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.outsider.email) });
      outsiderId = outsider.id;
      await prisma.user.update({ where: { id: outsiderId }, data: { oidcIssuer: idp.issuer, oidcSubject: SUBJECT } });
      // A membership added by hand: the sync leaves it alone.
      const manual = await prisma.group.create({ data: { name: MANUAL } });
      await prisma.groupMember.create({ data: { groupId: manual.id, userId: outsiderId } });
    });
  });

  test.afterAll(async () => {
    await withPrisma(async (prisma) => {
      await prisma.groupMember.deleteMany({ where: { userId: outsiderId } });
      await prisma.group.deleteMany({ where: { name: { in: [SALES, DEV, MANUAL] } } });
      await prisma.user.update({
        where: { id: outsiderId },
        data: { name: "E2E 部外者", oidcIssuer: null, oidcSubject: null },
      });
      await prisma.instanceConfig.update({ where: { id: 1 }, data: { publicUrl: previousPublicUrl } });
      if (previousOidc) {
        const { enabled, issuer, clientId, clientSecretEnc, buttonLabel, nameClaim, syncName, groupsClaim } = previousOidc;
        const { newUserRole, allowedDomains, trustEmail, allowNameChange, passwordLogin } = previousOidc;
        await prisma.oidcSettings.update({
          where: { id: 1 },
          data: { enabled, issuer, clientId, clientSecretEnc, buttonLabel, nameClaim, syncName, groupsClaim, newUserRole, allowedDomains, trustEmail, allowNameChange, passwordLogin },
        });
      } else {
        await prisma.oidcSettings.deleteMany({});
      }
    });
    await idp.close();
  });

  test("the name and groups come from the identity provider, again at every sign-in", async ({ browser }) => {
    // Some claims in the ID token, the rest in UserInfo.
    idp.idToken = { email: ACCOUNTS.outsider.email, email_verified: true, given_name: "太郎" };
    idp.userInfo = { family_name: "山田", department: "営業部", groups: [SALES, "E2E 閲覧"] };
    let { context, page } = await signInWithSso(browser);
    // The template, filled from both, with its own text ("@").
    await expect(page.getByTestId("ProfileSection.name")).toHaveText("山田 太郎@営業部");
    await expect(page.getByTestId("ProfileSection.nameLocked")).toBeVisible();
    await sameMemberships([
      { viaOidc: true, group: { name: "E2E 閲覧", oidcCreated: false } },
      { viaOidc: true, group: { name: SALES, oidcCreated: true } },
      { viaOidc: false, group: { name: MANUAL, oidcCreated: false } },
    ]);
    // "E2E 閲覧" (an existing group of that name) gives its permissions.
    await openPage(page, HOME_PAGE_ID);
    await expect(editorBody(page)).toBeVisible();
    await context.close();

    // Moved to another department: the name follows, the groups too.
    idp.userInfo = { family_name: "山田", department: "開発部", groups: [DEV] };
    ({ context, page } = await signInWithSso(browser));
    await expect(page.getByTestId("ProfileSection.name")).toHaveText("山田 太郎@開発部");
    await sameMemberships([
      { viaOidc: true, group: { name: DEV, oidcCreated: true } },
      { viaOidc: false, group: { name: MANUAL, oidcCreated: false } },
    ]);
    // The group sync is in the audit log.
    const logged = await withPrisma((prisma) => prisma.auditLog.count({ where: { action: "group.member.oidc" } }));
    expect(logged).toBeGreaterThanOrEqual(2);
    await context.close();
  });

  test("the admin console's login page signs in through single sign-on too, then asks for the authenticator", async ({ browser }) => {
    idp.idToken = { email: ACCOUNTS.outsider.email, email_verified: true, given_name: "太郎" };
    idp.userInfo = { family_name: "山田", department: "営業部", groups: [] };
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Not an admin: back to the admin login page with the reason.
      await page.goto("admin/login");
      await page.getByTestId("AdminLoginPage.ssoButton").click();
      await expect(page.getByTestId("AdminLoginPage.ssoError")).toContainText("管理画面にはログインできません");

      // A content manager without an authenticator yet: on to registering one,
      // as after the password.
      await withPrisma((prisma) => prisma.user.update({ where: { id: outsiderId }, data: { siteRole: "CONTENT_MANAGER" } }));
      await page.getByTestId("AdminLoginPage.ssoButton").click();
      await expect(page).toHaveURL(/\/admin\/enroll$/);
      await expect(page.getByTestId("AdminEnrollPage")).toBeVisible();
      // Not signed in to the app by it.
      await page.goto("account");
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await context.close();
      await withPrisma(async (prisma) => {
        await prisma.adminSession.deleteMany({ where: { userId: outsiderId } });
        await prisma.user.update({ where: { id: outsiderId }, data: { siteRole: "USER", totpSecret: null } });
      });
    }
  });
});
