import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { editorBody, openPage } from "./helpers";

test.describe("Permissions", () => {
  test.describe("View only", () => {
    test.use({ storageState: authFile("viewer") });

    test("can read a page but not edit it or add child pages", async ({ page }) => {
      await openPage(page, HOME_PAGE_ID);
      await expect(page.getByTestId("PageView.readOnlyBadge")).toBeVisible();
      await expect(editorBody(page)).toHaveAttribute("contenteditable", "false");
      await expect(page.getByTestId("TitleField")).toHaveAttribute("readonly", "");
      await expect(page.locator(`[data-ui="DocTree.addChildButton"][data-id="${HOME_PAGE_ID}"]`)).toHaveCount(0);
    });
  });

  test.describe("Users without access", () => {
    test.use({ storageState: authFile("outsider") });

    test("opening the page gives a 404, and it isn't in the sidebar", async ({ page }) => {
      const response = await page.goto(`pages/${HOME_PAGE_ID}`);
      expect(response?.status()).toBe(404);
      await page.goto("./");
      await expect(page.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`)).toHaveCount(0);
    });
  });
});