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

  test("Enter keeps the line's indentation, and still leaves the block after two empty lines", async ({ page }) => {
    await createPage(page, "E2E コードのインデント");
    await typeInBody(page, "``` ");
    const block = editorBody(page).locator('[data-content-type="codeBlock"]');
    await page.keyboard.type("if (a) {");
    await page.keyboard.press("Enter");
    await page.keyboard.type("    b();");
    await page.keyboard.press("Enter");
    await page.keyboard.type("c();");
    await expect(block.locator("code")).toHaveText("if (a) {\n    b();\n    c();");
    // Enter on an indented empty line at the end drops its indentation, so
    // the third Enter still leaves the block.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("後の段落");
    await expect(block.locator("code")).toHaveText("if (a) {\n    b();\n    c();");
    await expect(editorBody(page).locator('[data-content-type="paragraph"]').last()).toHaveText("後の段落");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("a preview is set apart from the code, with a badge", async ({ page }) => {
    await createPage(page, "E2E プレビューの見た目");
    await typeInBody(page, "```markdown ");
    await page.keyboard.type("**太字**");
    const block = editorBody(page).locator('[data-content-type="codeBlock"]');
    await block.getByTestId("CodeBlock.previewSelect").selectOption("below");
    await expect(block.getByTestId("CodeBlock.previewBadge")).toHaveText("プレビュー");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("are highlighted by their language, chosen with ```python or the picker", async ({ page }) => {
    await createPage(page, "E2E コードの色分け");
    await typeInBody(page, "```python ");
    const block = editorBody(page).locator('[data-content-type="codeBlock"]');
    await expect(block.locator("> div > select")).toHaveValue("python");
    await page.keyboard.type("def hello():");
    // Shiki's colours on the code's tokens (loaded on first use).
    await expect(block.locator('code span[style*="--shiki"]').first()).toBeVisible({ timeout: 15_000 });

    // Perl isn't in BlockNote's list; it's ours (code-languages.ts).
    await block.locator("> div > select").selectOption("perl");
    await expect(block).toHaveAttribute("data-language", "perl");
    await expect(block.locator('code span[style*="--shiki"]').first()).toBeVisible({ timeout: 15_000 });

    await block.locator("> div > select").selectOption("javascript");
    await expect(block).toHaveAttribute("data-language", "javascript");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.reload();
    await expect(editorBody(page).locator('[data-content-type="codeBlock"] > div > select')).toHaveValue("javascript");
    await trashOpenPage(page);
  });
  test("lists languages A to Z, and formats the code with the chosen indent", async ({ page }) => {
    await createPage(page, "E2E コードの整形");
    await typeInBody(page, "```javascript ");
    const block = editorBody(page).locator('[data-content-type="codeBlock"]');
    // Plain text first, then by name.
    const names = await block.locator("> div > select option").allTextContents();
    expect(names[0]).toBe("Plain Text");
    const rest = names.slice(1);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));

    await page.keyboard.type("function f(){return {a:1}}");
    await block.getByTestId("CodeBlock.indentSelect").selectOption("4");
    await block.getByTestId("CodeBlock.formatButton").click();
    await expect(block.locator("code")).toHaveText("function f() {\n    return { a: 1 };\n}");

    // A language without a formatter: only the indentation changes.
    await block.locator("> div > select").selectOption("python");
    await block.getByTestId("CodeBlock.indentSelect").selectOption("2");
    await block.getByTestId("CodeBlock.formatButton").click();
    await expect(block.locator("code")).toHaveText("function f() {\n  return { a: 1 };\n}");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
});
