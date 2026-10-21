import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, pasteFile, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

// A 1×1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// A two-page PDF, built by hand (no fonts or content: two blank pages).
function twoPagePdf(): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return base64(pdf);
}

test.describe("Files", () => {
  test("expanding a text file into the page makes each line a paragraph", async ({ page }) => {
    await createPage(page, "E2E テキスト");
    await pasteFile(page, { name: "メモ.txt", type: "text/plain", base64: base64("一行目です\n\n二行目です\n") });

    const dialog = page.getByTestId("AppDialog");
    await expect(dialog).toContainText("メモ.txt");
    await dialog.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();

    await expect(editorBody(page)).toContainText("一行目です");
    await expect(editorBody(page)).toContainText("二行目です");
    // The file block BlockNote made for the upload is gone.
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("a Markdown file can replace the whole page, title included", async ({ page }) => {
    const { id, title: oldTitle } = await createPage(page, "E2E 置き換え");
    await typeInBody(page, "置き換える前の本文");
    // Let the edit reach the server (it goes into the history before the replace).
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.waitForTimeout(500);

    const markdown = "# 新しいタイトル\n\n置き換えた本文\n\n# 二つ目の見出し\n";
    await pasteFile(page, { name: "置き換え.md", type: "text/markdown", base64: base64(markdown) });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="replace"]').click();
    await page.getByTestId("AppDialog.confirmButton").click();

    // The leading heading became the title; the rest is the body (a later H1 is an H2).
    await expect(page.getByTestId("TitleField")).toHaveValue("新しいタイトル");
    await expect(editorBody(page)).toContainText("置き換えた本文");
    await expect(editorBody(page)).not.toContainText("置き換える前の本文");
    await expect(editorBody(page)).not.toContainText("新しいタイトル");
    await expect(editorBody(page).locator('[data-content-type="heading"]')).toHaveText("二つ目の見出し");
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(0);

    // Without a leading heading, the title is the file name.
    await pasteFile(page, { name: "議事録.md", type: "text/markdown", base64: base64("本文だけ\n") });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="replace"]').click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("TitleField")).toHaveValue("議事録");
    await expect(editorBody(page)).toContainText("本文だけ");
    await expect(editorBody(page)).not.toContainText("置き換えた本文");

    // What was there before each replace is in the history (newest first:
    // before the second, then before the first).
    await page.goto(`pages/${id}/history`);
    const versions = page.getByTestId("HistoryView.version");
    await expect(versions).toHaveCount(2);
    await versions.nth(1).click();
    await expect(page.getByTestId("HistoryView.preview")).toContainText(oldTitle);
    await expect(page.getByTestId("HistoryView.preview")).toContainText("置き換える前の本文");
    await versions.nth(0).click();
    await expect(page.getByTestId("HistoryView.preview")).toContainText("置き換えた本文");
    await openPage(page, id);
    await trashOpenPage(page);
  });

  test("a mermaid block in Markdown becomes a diagram", async ({ page }) => {
    await createPage(page, "E2E Mermaid");
    const markdown = "# 見出し\n\n```mermaid\nflowchart TD\n  A[開始] --> B[終了]\n```\n";
    await pasteFile(page, { name: "図.md", type: "text/markdown", base64: base64(markdown) });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();

    await expect(editorBody(page).locator('[data-content-type="heading"]')).toContainText("見出し");
    await expect(page.getByTestId("MermaidBlock.diagram").locator("svg")).toBeVisible();
    await expect(page.getByTestId("MermaidBlock.error")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("an attached image is uploaded and shown", async ({ page }) => {
    await createPage(page, "E2E 画像");
    await pasteFile(page, { name: "点.png", type: "image/png", base64: PNG });

    const image = editorBody(page).locator('[data-content-type="image"] img');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", /\/api\/files\//);
    // The stored file comes back (decrypted) as an image.
    const src = await image.getAttribute("src");
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    await expect(page.getByTestId("AppDialog")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("a PDF shown page by page can be paged through", async ({ page }) => {
    await createPage(page, "E2E PDF 表示");
    await pasteFile(page, { name: "資料.pdf", type: "application/pdf", base64: twoPagePdf() });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="embed"]').click();

    const block = page.getByTestId("PdfBlock");
    await expect(block.getByTestId("PdfBlock.status")).toHaveText("1 / 2");
    await expect(block.getByTestId("PdfBlock.error")).toHaveCount(0);
    await block.getByTestId("PdfBlock.nextButton").click();
    await expect(block.getByTestId("PdfBlock.status")).toHaveText("2 / 2");
    await expect(block.getByTestId("PdfBlock.nextButton")).toBeDisabled();
    await trashOpenPage(page);
  });

  test("a file with an extension that isn't allowed can't be added", async ({ page }) => {
    await createPage(page, "E2E 拒否");
    await pasteFile(page, { name: "tool.exe", type: "application/octet-stream", base64: base64("MZ") });

    const dialog = page.getByTestId("AppDialog");
    await expect(dialog).toContainText(".exe");
    await page.getByTestId("AppDialog.closeButton").click();
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(0);
    await trashOpenPage(page);
  });
});