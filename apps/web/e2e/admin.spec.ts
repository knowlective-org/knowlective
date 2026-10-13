import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, adminTotpCode, authFile } from "./accounts";

test.describe("管理画面", () => {
  test("サイト管理者は、パスワードと認証コードの2段階でログインできる", async ({ page }) => {
    await page.goto("admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByTestId("AdminLoginPage.appLink")).toBeVisible();

    await page.getByTestId("AccountLoginForm.emailInput").fill(ACCOUNTS.admin.email);
    await page.getByTestId("AccountLoginForm.passwordInput").fill(PASSWORD);
    await page.getByTestId("AccountLoginForm.submitButton").click();

    await expect(page).toHaveURL(/\/admin\/login\/verify/);
    await page.getByTestId("CodeField.input").fill(adminTotpCode());
    await page.getByTestId("VerifyCodeForm.submitButton").click();
    await page.waitForURL((url) => url.pathname.endsWith("/admin"));

    // Users: the test accounts are listed.
    await page.getByTestId("AdminSidebar.navLink").filter({ hasText: "ユーザー" }).click();
    await expect(page.getByTestId("AdminUsersPage.userRow").filter({ hasText: ACCOUNTS.editor.email })).toBeVisible();

    // Overview: the link preview settings, on and public-only by default.
    await page.getByTestId("AdminSidebar.navLink").filter({ hasText: "概要" }).click();
    await expect(page.getByTestId("LinkPreviewSettingsForm.enabledCheckbox")).toBeChecked();
    await expect(page.getByTestId("LinkPreviewSettingsForm.allowPrivateCheckbox")).not.toBeChecked();
    // The proxy's credentials are only asked for once a proxy is entered.
    await expect(page.getByTestId("LinkPreviewSettingsForm.proxyPasswordInput")).toHaveCount(0);
    await page.getByTestId("LinkPreviewSettingsForm.proxyUrlInput").fill("http://proxy.example.co.jp:8080");
    await expect(page.getByTestId("LinkPreviewSettingsForm.proxyPasswordInput")).toBeVisible();
    // Saving: allow the intranet, check it's kept, and put it back.
    await page.getByTestId("LinkPreviewSettingsForm.proxyUrlInput").fill("");
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
    // A proxy URL with credentials in it is refused.
    await page.getByTestId("LinkPreviewSettingsForm.proxyUrlInput").fill("http://user:pw@proxy.example.co.jp:8080");
    await page.getByTestId("LinkPreviewSettingsForm.submitButton").click();
    await expect(status).toContainText("下の欄に入力");

    // Files: the allowed extensions are shown as tags, and adding one works.
    await page.getByTestId("AdminSidebar.navLink").filter({ hasText: "ファイル" }).click();
    await expect(page.locator('[data-ui="UploadTypesForm.extensionItem"][data-id="pdf"]')).toBeVisible();
    await page.getByTestId("UploadTypesForm.extensionInput").fill("e2etest,");
    await expect(page.locator('[data-ui="UploadTypesForm.extensionItem"][data-id="e2etest"]')).toBeVisible();
    // Removed again without saving.
    await page.locator('[data-ui="UploadTypesForm.removeButton"][data-id="e2etest"]').click();
    await expect(page.locator('[data-ui="UploadTypesForm.extensionItem"][data-id="e2etest"]')).toHaveCount(0);
  });

  test.describe("一般ユーザー", () => {
    test.use({ storageState: authFile("editor") });

    test("管理者でないアカウントは、パスワードが正しくても入れない", async ({ page }) => {
      await page.goto("admin/login");
      await page.getByTestId("AccountLoginForm.emailInput").fill(ACCOUNTS.editor.email);
      await page.getByTestId("AccountLoginForm.passwordInput").fill(PASSWORD);
      await page.getByTestId("AccountLoginForm.submitButton").click();
      await expect(page.getByTestId("AccountLoginForm.error")).not.toBeEmpty();
      await expect(page).toHaveURL(/\/admin\/login/);
    });
  });
});