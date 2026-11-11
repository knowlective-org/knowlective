import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, authFile } from "./accounts";
import { freshAdminCode } from "./admin-login";

test.describe("Admin console", () => {
  test("a site admin logs in with a password, then an authenticator code", async ({ page }) => {
    await page.goto("admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByTestId("AdminLoginPage.appLink")).toBeVisible();

    await page.getByTestId("AccountLoginForm.emailInput").fill(ACCOUNTS.admin.email);
    await page.getByTestId("AccountLoginForm.passwordInput").fill(PASSWORD);
    await page.getByTestId("AccountLoginForm.submitButton").click();

    await expect(page).toHaveURL(/\/admin\/login\/verify/);
    await page.getByTestId("CodeField.input").fill(await freshAdminCode());
    await page.getByTestId("VerifyCodeForm.submitButton").click();
    await page.waitForURL((url) => url.pathname.endsWith("/admin"));

    // Users: the test accounts are listed.
    await page.getByTestId("AdminSidebar.navLink").filter({ hasText: "ユーザー" }).click();
    await expect(page.getByTestId("AdminUsersPage.userRow").filter({ hasText: ACCOUNTS.editor.email })).toBeVisible();

    // Overview: the link preview settings, on and public-only by default.
    await page.getByTestId("AdminSidebar.navLink").filter({ hasText: "概要" }).click();
    await expect(page.getByTestId("LinkPreviewSettingsForm.enabledCheckbox")).toBeChecked();
    await expect(page.getByTestId("LinkPreviewSettingsForm.allowPrivateCheckbox")).not.toBeChecked();
    // Saving: allow the intranet, check it's kept, and put it back.
    const allowPrivate = page.getByTestId("LinkPreviewSettingsForm.allowPrivateCheckbox");
    const status = page.getByTestId("LinkPreviewSettingsForm.status");
    await allowPrivate.check();
    await page.getByTestId("LinkPreviewSettingsForm.submitButton").click();
    await expect(status).toHaveText("保存しました。");
    await page.reload();
    await expect(allowPrivate).toBeChecked();
    await allowPrivate.uncheck();
    await page.getByTestId("LinkPreviewSettingsForm.submitButton").click();
    await expect(status).toHaveText("保存しました。");
    await page.reload();
    await expect(allowPrivate).not.toBeChecked();

    // Files: adding files can be turned off (and back on).
    await page.getByTestId("AdminSidebar.navLink").filter({ hasText: "ファイル" }).click();
    const uploads = page.getByTestId("UploadsEnabledForm.enabledCheckbox");
    await expect(uploads).toBeChecked();
    await uploads.uncheck();
    await page.getByTestId("UploadsEnabledForm.submitButton").click();
    await expect(page.getByTestId("UploadsEnabledForm.status")).toHaveText("保存しました。");
    await page.reload();
    await expect(uploads).not.toBeChecked();
    await uploads.check();
    await page.getByTestId("UploadsEnabledForm.submitButton").click();
    await expect(page.getByTestId("UploadsEnabledForm.status")).toHaveText("保存しました。");
    await page.reload();
    await expect(uploads).toBeChecked();

    // The allowed extensions are shown as tags, and adding one works.
    await expect(page.locator('[data-ui="UploadTypesForm.extensionItem"][data-id="pdf"]')).toBeVisible();
    await page.getByTestId("UploadTypesForm.extensionInput").fill("e2etest,");
    await expect(page.locator('[data-ui="UploadTypesForm.extensionItem"][data-id="e2etest"]')).toBeVisible();
    // Removed again without saving.
    await page.locator('[data-ui="UploadTypesForm.removeButton"][data-id="e2etest"]').click();
    await expect(page.locator('[data-ui="UploadTypesForm.extensionItem"][data-id="e2etest"]')).toHaveCount(0);
  });

  test.describe("Regular users", () => {
    test.use({ storageState: authFile("editor") });

    test("an account that isn't an admin can't get in, even with the right password", async ({ page }) => {
      await page.goto("admin/login");
      await page.getByTestId("AccountLoginForm.emailInput").fill(ACCOUNTS.editor.email);
      await page.getByTestId("AccountLoginForm.passwordInput").fill(PASSWORD);
      await page.getByTestId("AccountLoginForm.submitButton").click();
      await expect(page.getByTestId("AccountLoginForm.error")).not.toBeEmpty();
      await expect(page).toHaveURL(/\/admin\/login/);
    });
  });
});