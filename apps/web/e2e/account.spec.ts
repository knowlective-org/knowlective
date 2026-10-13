import { expect, test } from "@playwright/test";
import { ACCOUNTS, HOME_PAGE_ID, authFile } from "./accounts";
import { openPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("アカウント", () => {
  test("サイドバーからアカウントの画面を開ける", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    await page.getByTestId("Sidebar.accountLink").click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("AccountPage.email")).toHaveText(ACCOUNTS.editor.email);
  });

  test("パスワードの再設定は、メール送信の設定に応じて出し分けられる", async ({ page }) => {
    await page.goto("/account");
    const section = page.getByTestId("AccountPage.passwordSection");
    await expect(section).toBeVisible();
    // The development database may or may not have mail set up: one of the
    // two is shown, never both, and without mail there is no send button.
    const form = page.getByTestId("OwnPasswordResetForm");
    const unavailable = page.getByTestId("AccountPage.passwordUnavailable");
    await expect(form.or(unavailable)).toBeVisible();
    if (await unavailable.isVisible()) {
      await expect(unavailable).toHaveAttribute("data-reason", "mail");
      await expect(page.getByTestId("OwnPasswordResetForm.submitButton")).toHaveCount(0);
    } else {
      await expect(form).toContainText(ACCOUNTS.editor.email);
    }
  });

  test("ログインしていないと開けない", async ({ browser }) => {
    // A context made by hand still gets this file's signed-in state unless
    // told otherwise.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
    await context.close();
  });
});
