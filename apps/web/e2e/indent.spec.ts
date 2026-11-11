import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

// Tab indents a block under the one above; Backspace at its start takes it
// back out, keeping its type (BlockNote would first turn it into a paragraph).
test.use({ storageState: authFile("editor") });

test("Backspace at the start of an indented list item outdents it and keeps the list", async ({ page }) => {
  await createPage(page, "E2E インデント");
  await typeInBody(page, "- 一つ目");
  await page.keyboard.press("Enter");
  await page.keyboard.type("二つ目");
  await page.keyboard.press("Home");
  // The editor learns of the caret's move from "selectionchange", which the
  // browser fires a moment later: a key before that acts at the end.
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorOffset)).toBe(0);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await page.keyboard.press("Tab");
  const second = editorBody(page).locator('[data-content-type="bulletListItem"]', { hasText: "二つ目" });
  const nested = editorBody(page).locator('.bn-block-group .bn-block-group [data-content-type="bulletListItem"]', { hasText: "二つ目" });
  await expect(nested).toHaveCount(1);

  await page.keyboard.press("Backspace");
  await expect(nested).toHaveCount(0);
  await expect(second).toHaveCount(1);
  await expect(editorBody(page).locator('[data-content-type="bulletListItem"]')).toHaveCount(2);

  // At the top level, BlockNote's own: first the list item becomes a paragraph.
  await page.keyboard.press("Backspace");
  await expect(editorBody(page).locator('[data-content-type="paragraph"]', { hasText: "二つ目" })).toHaveCount(1);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
