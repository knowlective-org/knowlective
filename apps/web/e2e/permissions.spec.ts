import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { editorBody, openPage } from "./helpers";

test.describe("権限", () => {
  test.describe("閲覧のみ", () => {
    test.use({ storageState: authFile("viewer") });

    test("ページは読めるが、編集と子ページの追加はできない", async ({ page }) => {
      await openPage(page, HOME_PAGE_ID);
      await expect(page.getByTestId("PageView.readOnlyBadge")).toBeVisible();
      await expect(editorBody(page)).toHaveAttribute("contenteditable", "false");
      await expect(page.getByTestId("TitleField")).toHaveAttribute("readonly", "");
      await expect(page.locator(`[data-ui="DocTree.addChildButton"][data-id="${HOME_PAGE_ID}"]`)).toHaveCount(0);
    });
  });

  test.describe("権限のないユーザー", () => {
    test.use({ storageState: authFile("outsider") });

    test("ページを開くと 404 になり、サイドバーにも出ない", async ({ page }) => {
      const response = await page.goto(`pages/${HOME_PAGE_ID}`);
      expect(response?.status()).toBe(404);
      await page.goto("./");
      await expect(page.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`)).toHaveCount(0);
    });
  });
});