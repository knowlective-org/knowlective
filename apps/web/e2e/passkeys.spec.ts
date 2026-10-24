import { type Page, expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { userWhere, withPrisma } from "./db";
import { signIn } from "./helpers";

// Passkeys, with Chromium's virtual authenticator standing in for the
// device (a built-in one with user verification, like a fingerprint reader).
// The outsider account is the one that registers them; the cleanup leaves the
// site and the account as they were.

async function useVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function setPasskeyRequired(required: boolean) {
  await withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { passkeyRequired: required } }));
}

async function removeOutsiderPasskeys() {
  await withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.outsider.email) });
    await prisma.userPasskey.deleteMany({ where: { userId: user.id } });
  });
}

async function registerPasskey(page: Page, name: string) {
  await page.getByTestId("PasskeyRegisterForm.nameInput").fill(name);
  await page.getByTestId("PasskeyRegisterForm.submitButton").click();
}

async function logInWithPasskey(page: Page) {
  await page.goto("login");
  await page.getByTestId("PasskeyLoginButton.button").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}

test.describe("Passkeys", () => {
  test.afterEach(async () => {
    await setPasskeyRequired(false);
    await removeOutsiderPasskeys();
  });

  test.describe("optional", () => {
    test.use({ storageState: authFile("outsider") });

    test("registered on the account screen, used to log in, and removed", async ({ page }) => {
      await useVirtualAuthenticator(page);
      await page.goto("account");
      await expect(page.getByTestId("PasskeySection.empty")).toBeVisible();
      await registerPasskey(page, "E2E のキー");
      const row = page.getByTestId("PasskeySection.row");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("E2E のキー");

      // Logged out in this browser only: the saved session stays for other tests.
      await page.context().clearCookies();
      await logInWithPasskey(page);
      await page.goto("account");
      await expect(page.getByTestId("AccountPage.email")).toHaveText(ACCOUNTS.outsider.email);
      // "Last used" is filled in.
      await expect(row.locator("td").nth(2)).not.toHaveText("—");

      // While optional, the password keeps working.
      await page.context().clearCookies();
      await signIn(page, ACCOUNTS.outsider.email);
      await page.waitForURL((url) => !url.pathname.endsWith("/login"));

      await page.goto("account");
      await page.getByTestId("PasskeySection.removeButton").click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect(page.getByTestId("PasskeySection.empty")).toBeVisible();
    });
  });

  test("required: registered at the first access, then only the passkey logs in", async ({ page, browser }) => {
    // Turned on in the admin console.
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const admin = await adminContext.newPage();
    await openAdmin(admin, "/users");
    await admin.getByTestId("PasskeySettingsForm.requiredCheckbox").check();
    await admin.getByTestId("PasskeySettingsForm.submitButton").click();
    await admin.getByTestId("AppDialog.confirmButton").click();
    await expect(admin.getByTestId("PasskeySettingsForm.status")).toHaveText("保存しました。");

    // The password logs in, but nothing opens until a passkey is registered.
    await useVirtualAuthenticator(page);
    await signIn(page, ACCOUNTS.outsider.email);
    await expect(page).toHaveURL(/\/passkey-setup/);
    await expect(page.getByTestId("PasskeySetupPage.email")).toContainText(ACCOUNTS.outsider.email);
    await page.goto("account");
    await expect(page).toHaveURL(/\/passkey-setup\?next=%2Faccount$/);
    await registerPasskey(page, "必須のキー");
    await expect(page).toHaveURL(/\/account$/);
    // The only one can't be removed while required.
    await expect(page.getByTestId("PasskeySection.removeButton")).toBeDisabled();

    // From now on the password alone doesn't log in; the passkey does.
    await page.context().clearCookies();
    await signIn(page, ACCOUNTS.outsider.email);
    await expect(page.getByTestId("LoginForm.error")).toContainText("パスキーでログイン");
    await logInWithPasskey(page);
    await expect(page).not.toHaveURL(/passkey-setup/);

    // Lost passkeys: an administrator removes them, the password logs in
    // again, and a new passkey is asked for.
    await admin.reload();
    const outsiderRow = admin.getByTestId("AdminUsersPage.userRow").filter({ hasText: ACCOUNTS.outsider.email });
    await outsiderRow.getByTestId("RowMenu.toggle").click();
    await admin.getByTestId("RowMenu.item").filter({ hasText: "パスキーを削除" }).click();
    await admin.getByTestId("AppDialog.confirmButton").click();
    // Done once the passkeys are gone (the menu's action runs in the background).
    await expect
      .poll(() =>
        withPrisma(async (prisma) => {
          const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.outsider.email) });
          return prisma.userPasskey.count({ where: { userId: user.id } });
        }),
      )
      .toBe(0);
    await page.goto("account");
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, ACCOUNTS.outsider.email);
    await expect(page).toHaveURL(/\/passkey-setup/);

    // Back to optional; the removal ended the outsider's saved session too,
    // so it's signed in again for the other tests.
    await admin.getByTestId("PasskeySettingsForm.requiredCheckbox").uncheck();
    await admin.getByTestId("PasskeySettingsForm.submitButton").click();
    await expect(admin.getByTestId("PasskeySettingsForm.status")).toHaveText("保存しました。");
    await adminContext.close();
    await page.goto("account");
    await expect(page.getByTestId("AccountPage")).toBeVisible();
    await page.context().storageState({ path: authFile("outsider") });
  });
});
