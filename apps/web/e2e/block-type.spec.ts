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
