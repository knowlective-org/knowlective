import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("Changing a block's type", () => {
  test("changes the heading level from the ⋮⋮ menu and back to a paragraph (no heading 1)", async ({ page }) => {
    await createPage(page, "E2E 種類の変更");
    await typeInBody(page, "## 種類を変える見出し");
    const block = editorBody(page).locator(".bn-block-content", { hasText: "種類を変える見出し" });
    await expect(block).toHaveAttribute("data-content-type", "heading");

    const changeTo = async (name: string) => {
      await block.hover();
      await page.locator(".bn-side-menu [draggable=true]").click();
      await page.getByRole("menuitem", { name: "種類を変更" }).hover();
      const options = page.locator(".bn-menu-dropdown").last();
      await expect(options.getByRole("menuitem", { name: "見出し２", exact: true })).toBeVisible();
      await expect(options.getByRole("menuitem", { name: "見出し１", exact: true })).toHaveCount(0);
      await options.getByRole("menuitem", { name, exact: true }).click();
    };

    await changeTo("見出し４");
    await expect(block).toHaveAttribute("data-level", "4");
    await changeTo("標準テキスト");
    await expect(block).toHaveAttribute("data-content-type", "paragraph");
    await expect(block).toHaveText("種類を変える見出し");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("the formatting toolbar offers no heading 1 either", async ({ page }) => {
    await createPage(page, "E2E 種類の一覧");
    await typeInBody(page, "選ぶ文章");
    await page.keyboard.press("Shift+Home");
    const toolbar = page.locator(".bn-formatting-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "標準テキスト" }).click();
    await expect(page.getByRole("menuitem", { name: "見出し２", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "見出し１", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "折りたたみ見出し１", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await trashOpenPage(page);
  });
});

test.describe("The ⋮⋮ menu", () => {
  test("duplicates a block, and copies it to the clipboard to paste as it was", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await createPage(page, "E2E 複製とコピー");
    await typeInBody(page, "### 複製する見出し");
    const headings = editorBody(page).locator('.bn-block-content[data-content-type="heading"]');
    const menu = async () => {
      await headings.first().hover();
      await page.locator(".bn-side-menu [draggable=true]").click();
    };

    await menu();
    await page.getByTestId("BlockMenu.duplicateItem").click();
    await expect(headings).toHaveCount(2);
    await expect(headings.nth(1)).toHaveText("複製する見出し");
    await expect(headings.nth(1)).toHaveAttribute("data-level", "3");

    await menu();
    await page.getByTestId("BlockMenu.copyItem").click();
    await expect(page.getByTestId("Notice")).toHaveText("コピーしました。");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("複製する見出し");
    // Pasted into the page: the same heading (its level kept, not moved down
    // as for something pasted from elsewhere).
    // Put the caret at the end of the last heading itself: a click on the
    // middle of the editor can land at the start of a heading, where Enter
    // makes an empty heading above it.
    await headings.last().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+v");
    await expect(headings).toHaveCount(3);
    await expect(headings.nth(2)).toHaveAttribute("data-level", "3");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
});
