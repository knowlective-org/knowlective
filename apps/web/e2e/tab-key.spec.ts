import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// Tab that nothing in the editor uses (components/editor/tab-stays.ts) does
// nothing: the focus stays in the text.
test.use({ storageState: authFile("editor") });

test("Tab in an empty list item that can't be indented does nothing (the focus stays in the text)", async ({ page }) => {
  await createPage(page, "E2E Tab");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  // A TODO further down: Tab once moved the focus to its checkbox.
  await page.keyboard.type("[ ] やること");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  for (const marker of ["1. ", "- ", "> ", "[ ] "]) {
    await page.keyboard.type(marker);
    for (const key of ["Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect(editorBody(page)).toBeFocused();
    }
    // Back to an empty paragraph for the next kind.
    await page.keyboard.press("Backspace");
  }
  await expect(editorBody(page).locator('[data-ui="TodoBlock"]').filter({ hasText: "やること" })).toHaveCount(1);

  // Where it can be indented, Tab still does.
  await page.keyboard.type("- 一つ目");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("二つ目");
  await expect(editorBody(page).locator(".bn-block-group .bn-block-group [data-content-type='bulletListItem']")).toHaveText("二つ目");
  await expect(editorBody(page)).toBeFocused();
  await trashOpenPage(page);
});
