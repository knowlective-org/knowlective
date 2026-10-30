import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { attachFile, createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

// A one-page PDF with a line of text (Helvetica), built by hand.
function textPdf(text: string): string {
  const stream = `BT /F1 18 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
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
  return Buffer.from(pdf, "latin1").toString("base64");
}

test.describe("Search", () => {
  test("a sentence-like query finds pages close in meaning, without the same words", async ({ page }) => {
    // Pages are embedded in the background once edits settle (and the model
    // may still be loading on a fresh server).
    test.setTimeout(180_000);
    const { id } = await createPage(page, "E2E 休暇の手続き");
    await typeInBody(page, "有給休暇を取得するには、前日までに勤怠システムで申請し、上長の承認を受けてください。");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Not one word in common with the page.
    const question = "休みを取りたいときはどうすればいい";
    const result = page.locator(`[data-ui="SearchPage.result"][data-id="${id}"]`);
    await expect
      .poll(
        async () => {
          await page.goto(`search?q=${encodeURIComponent(question)}`);
          return result.count();
        },
        { timeout: 150_000, intervals: [3_000] },
      )
      .toBe(1);
    await expect(page.getByTestId("SearchPage.status")).toHaveAttribute("data-mode", "semantic");
    await expect(result).toContainText("意味が近い");

    // The same query by its words alone finds nothing.
    await page.getByTestId("SearchPage.switchModeLink").click();
    await expect(page.getByTestId("SearchPage.status")).toHaveAttribute("data-mode", "keyword");
    await expect(result).toHaveCount(0);

    await page.goto(`pages/${id}`);
    await trashOpenPage(page);
  });

  test("attachments are found by their content, until their block is removed", async ({ page }) => {
    test.setTimeout(120_000);
    const { id } = await createPage(page, "E2E 添付の検索");
    const stamp = Date.now();
    const textWord = `zqtxt${stamp}`;
    const pdfWord = `zqpdf${stamp}`;
    await attachFile(page, {
      name: "メモ.txt",
      type: "text/plain",
      base64: Buffer.from(`添付ファイルの中だけにある語 ${textWord}`).toString("base64"),
    });
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(1);
    await attachFile(page, { name: "report.pdf", type: "application/pdf", base64: textPdf(`Report ${pdfWord}`) });
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(2);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Found by words only in the files (read in the background, then indexed).
    const result = page.locator(`[data-ui="SearchPage.result"][data-id="${id}"]`);
    const found = (q: string) =>
      expect
        .poll(
          async () => {
            await page.goto(`search?q=${q}&mode=keyword`);
            return result.count();
          },
          { timeout: 60_000, intervals: [2_000] },
        );
    await found(textWord).toBe(1);
    await expect(result.getByTestId("SearchPage.matchedFile")).toContainText("メモ.txt");
    await expect(result.getByTestId("SearchPage.matchedFile")).toContainText(textWord);
    await found(pdfWord).toBe(1);
    await expect(result.getByTestId("SearchPage.matchedFile")).toContainText("report.pdf");

    // The blocks removed from the page: the files are no longer found.
    await page.goto(`pages/${id}`);
    const fileBlocks = editorBody(page).locator('[data-content-type="file"]');
    for (let left = 2; left > 0; left--) {
      // From the block's ⋮⋮ menu.
      await fileBlocks.first().hover();
      await page.locator(".bn-side-menu [draggable=true]").click();
      await page.getByRole("menuitem", { name: "削除" }).click();
      await expect(fileBlocks).toHaveCount(left - 1);
    }
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await found(textWord).toBe(0);
    await found(pdfWord).toBe(0);

    await page.goto(`pages/${id}`);
    await trashOpenPage(page);
  });

  test("short words and model numbers are searched as typed", async ({ page }) => {
    for (const q of ["議事録", "ABC-123", "「申請方法について」"]) {
      await page.goto(`search?q=${encodeURIComponent(q)}`);
      await expect(page.getByTestId("SearchPage.status")).toHaveAttribute("data-mode", "keyword");
    }
  });
});
