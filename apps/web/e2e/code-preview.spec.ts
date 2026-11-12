import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

// A code block's preview: the result of HTML, Markdown, Mermaid and LaTeX
// code, below the code or in its place.
test.use({ storageState: authFile("editor") });

// Types a code block where the cursor is (the first one at the end of the
// page), then leaves it for a new paragraph below (Shift+Enter).
async function codeBlock(page: import("@playwright/test").Page, language: string, code: string, nth = 0) {
  if (nth === 0) await typeInBody(page, `\`\`\`${language} `);
  else await page.keyboard.type(`\`\`\`${language} `);
  const block = editorBody(page).locator('[data-content-type="codeBlock"]').nth(nth);
  await expect(block.locator("> div > select")).toHaveValue(language);
  await page.keyboard.type(code);
  await page.keyboard.press("Shift+Enter");
  return block;
}

test.describe("Code block previews", () => {
  test("HTML runs in a frame of its own: no access to the page or the network", async ({ page }) => {
    await createPage(page, "E2E コードのプレビュー HTML");
    const block = await codeBlock(
      page,
      "html",
      `<p id="out">before</p><script>` +
        `document.getElementById("out").textContent = "ran";` +
        `try { parent.document.title; document.body.append("parent:reached"); } catch { document.body.append("parent:isolated"); }` +
        `fetch("https://example.com/").then(() => document.body.append(" net:reached"), () => document.body.append(" net:blocked"));` +
        `</script>`,
    );
    // No preview until an editor picks one.
    await expect(block.getByTestId("CodeBlock.preview")).toHaveCount(0);
    await block.getByTestId("CodeBlock.previewSelect").selectOption("below");
    const frame = block.frameLocator('[data-ui="CodeBlock.previewFrame"]');
    await expect(frame.locator("#out")).toHaveText("ran");
    await expect(frame.locator("body")).toContainText("parent:isolated");
    await expect(frame.locator("body")).toContainText("net:blocked");
    await expect(block.locator("> pre")).toBeVisible();

    // Drawn again as the code changes.
    // (Ctrl+A in a code block selects its code: replaced by what's typed.)
    await block.locator("code").click();
    // The editor takes the click's caret a moment later (selectionchange):
    // keys pressed before that act where the caret was.
    await expect
      .poll(() => block.locator("code").evaluate((code) => code.contains(window.getSelection()?.anchorNode ?? null)))
      .toBe(true);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await page.keyboard.press("Control+a");
    await page.keyboard.type("<b id=\"more\">more</b>");
    await expect(frame.locator("#more")).toHaveText("more");
    await expect(frame.locator("#out")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("Markdown, Mermaid and LaTeX; with only the preview, viewers see just the result", async ({ page, browser }) => {
    const { id } = await createPage(page, "E2E コードのプレビュー");
    // All three first: picking a preview takes the focus out of the page.
    const markdown = await codeBlock(page, "markdown", "## 見出し **太字** <img src=x onerror=alert(1)>");
    const latex = await codeBlock(page, "latex", String.raw`rac{a}{b} + \sqrt{x}`, 1);
    const mermaid = await codeBlock(page, "mermaid", "graph TD; A-->B", 2);

    await markdown.getByTestId("CodeBlock.previewSelect").selectOption("below");
    const md = markdown.frameLocator('[data-ui="CodeBlock.previewFrame"]');
    await expect(md.locator("strong")).toHaveText("太字");

    await latex.getByTestId("CodeBlock.previewSelect").selectOption("only");
    await expect(latex.locator(".katex").first()).toBeVisible({ timeout: 15_000 });
    // The code is hidden, the picker stays for editors.
    await expect(latex.locator("> pre")).toBeHidden();
    await expect(latex.getByTestId("CodeBlock.previewSelect")).toHaveValue("only");

    await mermaid.getByTestId("CodeBlock.previewSelect").selectOption("below");
    await expect(mermaid.locator(".knowlective-code-preview-diagram svg")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.waitForTimeout(1500);

    // Someone who can only view the page: the results, without the pickers.
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    try {
      const viewer = await viewerContext.newPage();
      await openPage(viewer, id);
      const blocks = editorBody(viewer).locator('[data-content-type="codeBlock"]');
      await expect(blocks.nth(1).locator(".katex").first()).toBeVisible({ timeout: 15_000 });
      await expect(blocks.nth(1).locator("> pre")).toBeHidden();
      await expect(blocks.nth(1).locator("> div > select")).toBeHidden();
      await expect(blocks.nth(2).locator(".knowlective-code-preview-diagram svg")).toBeVisible({ timeout: 15_000 });
      await expect(viewer.getByTestId("CodeBlock.previewSelect")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
    await trashOpenPage(page);
  });
});
