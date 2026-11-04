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

  test("are highlighted by their language, chosen with ```python or the picker", async ({ page }) => {
    await createPage(page, "E2E コードの色分け");
    await typeInBody(page, "```python ");
    const block = editorBody(page).locator('[data-content-type="codeBlock"]');
    await expect(block.locator("select")).toHaveValue("python");
    await page.keyboard.type("def hello():");
    // Shiki's colours on the code's tokens (loaded on first use).
    await expect(block.locator('code span[style*="--shiki"]').first()).toBeVisible({ timeout: 15_000 });

    // Perl isn't in BlockNote's list; it's ours (code-languages.ts).
    await block.locator("select").selectOption("perl");
    await expect(block).toHaveAttribute("data-language", "perl");
    await expect(block.locator('code span[style*="--shiki"]').first()).toBeVisible({ timeout: 15_000 });

    await block.locator("select").selectOption("javascript");
    await expect(block).toHaveAttribute("data-language", "javascript");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.reload();
    await expect(editorBody(page).locator('[data-content-type="codeBlock"] select')).toHaveValue("javascript");
    await trashOpenPage(page);
  });
});
