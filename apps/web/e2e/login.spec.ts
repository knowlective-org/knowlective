import { expect, test } from "@playwright/test";
import { ACCOUNTS } from "./accounts";
import { signIn } from "./helpers";

test.describe("Login", () => {
  test("a wrong password shows an error and doesn't log in", async ({ page }) => {
    await signIn(page, ACCOUNTS.editor.email, "wrong-password");
    await expect(page.getByTestId("LoginForm.error")).not.toBeEmpty();
    await expect(page).toHaveURL(/\/login/);
  });

  test("the right password opens the pages", async ({ page }) => {
    await signIn(page, ACCOUNTS.editor.email);
    await page.waitForURL(/\/pages\//);
    await expect(page.getByTestId("AppShell.sidebar")).toBeVisible();
  });

  test("without logging in, a page sends you to the login screen", async ({ page }) => {
    await page.goto("pages/e2e-home");
    await expect(page).toHaveURL(/\/login/);
  });
});