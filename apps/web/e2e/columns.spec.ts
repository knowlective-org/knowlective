import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test("a column layout holds blocks side by side, and stays after a reload", async ({ page }) => {
  await createPage(page, "E2E カラム");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  // Two and three columns are both offered.
  await page.keyboard.type("/列");
  await expect(page.getByRole("option", { name: /3列レイアウト/ })).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("カラム");
  await page.getByRole("option", { name: /2列レイアウト/ }).click();

  const list = editorBody(page).locator(".bn-block-column-list");
  await expect(list).toHaveCount(1);
  const columns = list.first().locator(":scope > .bn-block-column");
  await expect(columns).toHaveCount(2);
  // Side by side: the second column starts to the right of the first.
  const [left, right] = [await columns.nth(0).boundingBox(), await columns.nth(1).boundingBox()];
  expect(right!.x).toBeGreaterThan(left!.x + left!.width / 2);

  await columns.nth(0).locator(".bn-inline-content").first().click();
  await page.keyboard.type("左の列");
  await columns.nth(1).locator(".bn-inline-content").first().click();
  await page.keyboard.type("右の列");

  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(editorBody(page).locator(".bn-block-column-list")).toHaveCount(1);
  await expect(editorBody(page).locator(".bn-block-column").nth(0)).toContainText("左の列");
  await expect(editorBody(page).locator(".bn-block-column").nth(1)).toContainText("右の列");
  await trashOpenPage(page);
});

// BlockNote removed every empty column, so with one left empty the layout
// fell back to a single column (patches/@blocknote__core@*.patch).
test("deleting the block of one of three columns leaves two", async ({ page }) => {
  await createPage(page, "E2E 3列の削除");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/3列");
  await page.getByRole("option", { name: /3列レイアウト/ }).click();
  const columns = editorBody(page).locator(".bn-block-column");
  await expect(columns).toHaveCount(3);
  await columns.nth(0).locator(".bn-inline-content").first().click();
  await page.keyboard.type("一列目");
  await columns.nth(1).locator(".bn-inline-content").first().click();
  await page.keyboard.type("二列目");

  // The middle column's block, deleted from its ⋮⋮ menu; the third stays empty.
  await columns.nth(1).locator(".bn-block-content").hover();
  await page.locator(".bn-side-menu [draggable=true]").click();
  await page.getByRole("menuitem", { name: "削除" }).click();
  await expect(editorBody(page).locator(".bn-block-column-list")).toHaveCount(1);
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(0)).toContainText("一列目");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
