import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("Code blocks", () => {
  test("aren't spellchecked, and Ctrl+A selects the code before the whole page", async ({ page }) => {
    await createPage(page, "E2E コードブロック");
    await typeInBody(page, "前の段落");
    await page.keyboard.press("Enter");
    await page.keyboard.type("``` ");
    const code = editorBody(page).locator('[data-content-type="codeBlock"] code');
    // Empty, so it has no size yet: wait for the element, not for it to be visible.
    await expect(code).toHaveAttribute("spellcheck", "false");
    await page.keyboard.type("const a = 1;");
    await page.keyboard.press("Enter");
    await page.keyboard.type("const b = 2;");

    // First press: the code only (typing replaces it, the paragraph stays).
    await page.keyboard.press("Control+a");
    await page.keyboard.type("replaced");
    await expect(code).toHaveText("replaced");
    await expect(editorBody(page)).toContainText("前の段落");

    // Second press: the whole page, as usual.
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+a");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("前の段落");

    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
});
