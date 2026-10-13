import { expect, test } from "@playwright/test";
import { ACCOUNTS } from "./accounts";
import { signIn } from "./helpers";

test.describe("ログイン", () => {
  test("パスワードが違うと、エラーが出てログインできない", async ({ page }) => {
    await signIn(page, ACCOUNTS.editor.email, "wrong-password");
    await expect(page.getByTestId("LoginForm.error")).not.toBeEmpty();
    await expect(page).toHaveURL(/\/login/);
  });

  test("正しいパスワードで、ページの画面に入れる", async ({ page }) => {
    await signIn(page, ACCOUNTS.editor.email);
    await page.waitForURL(/\/pages\//);
    await expect(page.getByTestId("AppShell.sidebar")).toBeVisible();
  });

  test("ログインしていないと、ページは開けずログイン画面になる", async ({ page }) => {
    await page.goto("/pages/e2e-home");
    await expect(page).toHaveURL(/\/login/);
  });
});