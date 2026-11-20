import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { clickInEditor, createPage, editorBody, trashOpenPage } from "./helpers";

// Tab that nothing in the editor uses (components/editor/tab-stays.ts) does
// nothing: the focus stays in the text.
test.use({ storageState: authFile("editor") });

// A page with an empty paragraph on top and a TODO below it (built with a
// click: ↑ right after Enter sometimes hasn't moved yet).
async function pageWithTodoBelow(page: import("@playwright/test").Page, title: string) {
  await createPage(page, title);
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  // A TODO further down: Tab once moved the focus to its checkbox.
  await page.keyboard.type("[ ] やること");
  const blocks = editorBody(page).locator("[data-content-type]");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(1)).toHaveAttribute("data-content-type", "todo");
  await clickInEditor(blocks.first().locator(".bn-inline-content"));
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(blocks.first()).toHaveText("");
  await expect(blocks.first()).toHaveAttribute("data-content-type", "paragraph");
}

const KINDS = [
  ["1. ", "numberedListItem"],
  ["- ", "bulletListItem"],
  ["> ", "quote"],
  ["[ ] ", "todo"],
] as const;

for (const [marker, kind] of KINDS) {
  test(`Tab in an empty ${kind} that can't be indented does nothing (the focus stays in the text)`, async ({ page }) => {
    await pageWithTodoBelow(page, `E2E Tab ${kind}`);
    await page.keyboard.type(marker);
    await expect(editorBody(page).locator("[data-content-type]").first()).toHaveAttribute("data-content-type", kind);
    for (const key of ["Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect(editorBody(page)).toBeFocused();
    }
    await expect(editorBody(page).locator('[data-ui="TodoBlock"]').filter({ hasText: "やること" })).toHaveCount(1);
    await trashOpenPage(page);
  });
}

test("Tab still indents where it can", async ({ page }) => {
  await pageWithTodoBelow(page, "E2E Tab の字下げ");
  await page.keyboard.type("- 一つ目");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("二つ目");
  await expect(editorBody(page).locator(".bn-block-group .bn-block-group [data-content-type='bulletListItem']")).toHaveText("二つ目");
  await expect(editorBody(page)).toBeFocused();
  await trashOpenPage(page);
});
