import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { withPrisma } from "./db";
import { attachFile, createPage, editorBody, openPage, pasteFile, trashOpenPage, typeInBody } from "./helpers";

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

// A one-page PDF with text (Helvetica, so ASCII only): a large title, a
// heading, and two lines of body text.
function textPdf(): string {
  const lines: [number, number, string][] = [
    [24, 160, "Quarterly Report"],
    [14, 130, "Overview"],
    [10, 110, "Sales went up this quarter,"],
    [10, 98, "mostly in the north."],
  ];
  const stream = lines.map(([size, y, t]) => `BT /F1 ${size} Tf 20 ${y} Td (${t}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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
  test("a PDF's text can be expanded into the page, or replace the page", async ({ page }) => {
    const { id } = await createPage(page, "E2E PDF の展開");
    await typeInBody(page, "前の本文");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    await pasteFile(page, { name: "report.pdf", type: "application/pdf", base64: textPdf() });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();
    const headings = editorBody(page).locator('[data-content-type="heading"]');
    await expect(headings).toHaveText(["Quarterly Report", "Overview"]);
    await expect(editorBody(page).locator('[data-content-type="paragraph"]', { hasText: "Sales" })).toHaveText(
      "Sales went up this quarter, mostly in the north.",
    );
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(0);
    // Nothing was uploaded.
    expect(await withPrisma((prisma) => prisma.fileObject.count({ where: { pageId: id } }))).toBe(0);

    // Replacing: the first heading is the title.
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.waitForTimeout(500);
    await pasteFile(page, { name: "report.pdf", type: "application/pdf", base64: textPdf() });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="replace"]').click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("TitleField")).toHaveValue("Quarterly Report");
    await expect(headings).toHaveText(["Overview"]);
    await expect(editorBody(page)).not.toContainText("前の本文");

    // A PDF without text (scanned, say) says so.
    await pasteFile(page, { name: "blank.pdf", type: "application/pdf", base64: twoPagePdf() });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();
    await expect(page.getByTestId("AppDialog")).toContainText("読み取れる文字がありません");
    await page.getByTestId("AppDialog.closeButton").click();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
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

  test("a CSV file can be attached or expanded into a table, its first row the header", async ({ page }) => {
    await createPage(page, "E2E CSV");
    await pasteFile(page, { name: "名簿.csv", type: "text/csv", base64: base64('名前,部署,メモ\n山田,開発,"カンマ, を含む"\n佐藤,営業\n') });

    const dialog = page.getByTestId("AppDialog");
    await expect(dialog).toContainText("名簿.csv");
    await expect(dialog).toContainText("1行目が見出しの行");
    await expect(dialog.locator('[data-ui="AppDialog.choiceButton"][data-id="attach"]')).toBeVisible();
    await dialog.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();

    const table = editorBody(page).locator('[data-content-type="table"]');
    await expect(table.locator("th")).toHaveText(["名前", "部署", "メモ"]);
    await expect(table.locator("tr").nth(1).locator("td")).toHaveText(["山田", "開発", "カンマ, を含む"]);
    await expect(table.locator("tr").nth(2).locator("td")).toHaveText(["佐藤", "営業", ""]);
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
    expect(response.headers()["accept-ranges"]).toBe("bytes");
    const whole = await response.body();

    // Part of it, as media players ask (Safari plays no video without 206).
    const part = await page.request.get(src!, { headers: { Range: "bytes=2-5" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-range"]).toBe(`bytes 2-5/${whole.length}`);
    expect(Buffer.compare(await part.body(), whole.subarray(2, 6))).toBe(0);
    const past = await page.request.get(src!, { headers: { Range: `bytes=${whole.length}-` } });
    expect(past.status()).toBe(416);
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

    // Full screen: the whole window (also with the block selected, which
    // BlockNote styles), on the same page; ← turns back, Esc leaves.
    // BlockNote's rule for a selected block's content, as the production
    // build orders the styles (after the block's own; the dev server's
    // order hides it).
    await page.addStyleTag({ content: ".bn-block-content.ProseMirror-selectednode>*,.ProseMirror-selectednode>.bn-block-content>*{position:relative}" });
    await block.locator("canvas").click();
    await expect(page.locator(".ProseMirror-selectednode [data-ui='PdfBlock']")).toHaveCount(1);
    await block.getByTestId("PdfBlock.fullscreenButton").click();
    await expect(block).toHaveAttribute("data-fullscreen", "true");
    const box = (await block.boundingBox())!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, page.viewportSize()!.width, page.viewportSize()!.height]);
    await expect(block.getByTestId("PdfBlock.status")).toHaveText("2 / 2");
    await page.keyboard.press("ArrowLeft");
    await expect(block.getByTestId("PdfBlock.status")).toHaveText("1 / 2");
    await page.keyboard.press("Escape");
    await expect(block).not.toHaveAttribute("data-fullscreen");
    await expect(block.getByTestId("PdfBlock.status")).toHaveText("1 / 2");
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

  test("with adding files turned off, nothing is uploaded; text files can still be expanded", async ({ page }) => {
    const { id } = await createPage(page, "E2E ファイルの追加なし");
    const set = (uploadsEnabled: boolean) =>
      withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { uploadsEnabled } }));
    await set(false);
    try {
      await pasteFile(page, { name: "点.png", type: "image/png", base64: PNG });
      const dialog = page.getByTestId("AppDialog");
      await expect(dialog).toContainText("ファイルの追加が無効");
      await page.getByTestId("AppDialog.closeButton").click();
      await expect(editorBody(page).locator('[data-content-type="image"]')).toHaveCount(0);

      // A text file: expanding only (no "attach").
      await pasteFile(page, { name: "メモ.txt", type: "text/plain", base64: base64("一行目") });
      await expect(page.locator('[data-ui="AppDialog.choiceButton"][data-id="attach"]')).toHaveCount(0);
      await page.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();
      await expect(editorBody(page)).toContainText("一行目");

      // The upload route refuses too.
      const response = await page.request.post(`api/files?pageId=${id}`, {
        multipart: { file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") } },
        headers: { Origin: new URL(page.url()).origin },
      });
      expect(response.status()).toBe(403);
    } finally {
      await set(true);
    }
    await trashOpenPage(page);
  });

  test("a file dropped outside the blocks goes at the end, with the same choices as in the page", async ({ page }) => {
    await createPage(page, "E2E 枠外へのドロップ");
    await typeInBody(page, "最初の段落");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    // Onto the title: not a block.
    await page.getByTestId("TitleField").evaluate((el, content) => {
      const data = new DataTransfer();
      data.items.add(new File([content], "落とした.md", { type: "text/markdown" }));
      const r = el.getBoundingClientRect();
      const at = { clientX: r.left + 5, clientY: r.top + 5, dataTransfer: data, bubbles: true, cancelable: true };
      el.dispatchEvent(new DragEvent("dragover", at));
      el.dispatchEvent(new DragEvent("drop", at));
    }, "落とした本文\n");
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="expand"]').click();
    await expect(editorBody(page)).toContainText("落とした本文");
    // After what was there.
    await expect(editorBody(page).locator(".bn-block-content").last()).toContainText("落とした本文");
    await expect(editorBody(page)).toContainText("最初の段落");
    await trashOpenPage(page);
  });

  // What the cleanup of attachments goes by (lib/file-cleanup.ts): a file
  // whose block is removed is no longer among the page's references, and is
  // marked when the cleanup next runs.
  test("removing an attachment's block drops it from the page's references", async ({ page }) => {
    const { id } = await createPage(page, "E2E 添付の削除");
    await attachFile(page, { name: "消すファイル.txt", type: "text/plain", base64: base64("消す") });
    const fileId = await withPrisma(async (prisma) => (await prisma.fileObject.findFirstOrThrow({ where: { pageId: id } })).id);
    const refs = () =>
      withPrisma(async (prisma) => (await prisma.pageFileRefs.findUnique({ where: { pageId: id } }))?.fileIds ?? []);
    await expect.poll(refs, { timeout: 15_000 }).toContain(fileId);

    await editorBody(page).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(0);
    await expect.poll(refs, { timeout: 15_000 }).not.toContain(fileId);
    await trashOpenPage(page);
  });
});