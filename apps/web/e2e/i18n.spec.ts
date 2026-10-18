import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";

// Display languages: the browser's (Accept-Language) unless the user chose
// one on the account screen. The tests' browser asks for Japanese.

test.describe("Display language", () => {
  test("an English browser gets English screens", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US", storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto("login");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByTestId("LoginForm.submitButton")).toHaveText("Log in");
    } finally {
      await context.close();
    }
  });

  test.describe("chosen on the account screen", () => {
    test.use({ storageState: authFile("viewer") });

    test("overrides the browser's, for the screens and the editor", async ({ page }) => {
      const choose = async (value: string) => {
        await page.goto("account");
        await page.getByTestId("LocaleForm.localeSelect").selectOption(value);
        await page.getByTestId("LocaleForm.submitButton").click();
        await expect(page.getByTestId("LocaleForm.status")).not.toBeEmpty();
      };
      try {
        await choose("en");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.getByTestId("LocaleForm.status")).toHaveText("Saved.");
        await page.goto(`pages/${HOME_PAGE_ID}`);
        await expect(page.getByTestId("PageView.readOnlyBadge")).toHaveText("View only");
        await expect(page.getByTestId("Sidebar.trashLink")).toHaveAttribute("aria-label", "Trash");
      } finally {
        // Back to the browser's language (Japanese) for the other tests.
        await choose("");
      }
      await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    });
  });
});
