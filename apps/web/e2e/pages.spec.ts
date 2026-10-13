import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("ページ", () => {
  test("作成してタイトルと本文を書くと、再読み込みしても残る", async ({ page }) => {
    const { id, title } = await createPage(page, "E2E 作成");
    await typeInBody(page, "本文のテキストです");
    // The sidebar shows the new title as it is typed.
    await expect(page.locator(`[data-ui="DocTree.link"][data-id="${id}"]`)).toContainText(title);

    await page.reload();
    await expect(editorBody(page)).toContainText("本文のテキストです");
    await expect(page.getByTestId("TitleField")).toHaveValue(title);

    await trashOpenPage(page);
  });

  test("削除するとごみ箱に入り、サイドバーから消える", async ({ page }) => {
    const { id, title } = await createPage(page, "E2E 削除");
    // The title reaches the database when the server saves the document.
    await page.waitForTimeout(3000);
    await trashOpenPage(page);
    await expect(page.locator(`[data-ui="DocTree.link"][data-id="${id}"]`)).toHaveCount(0);

    await page.goto("trash");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("Markdown で書き出すと、タイトルと本文が入ったファイルが落ちてくる", async ({ page }) => {
    const { title } = await createPage(page, "E2E 書き出し");
    await typeInBody(page, "書き出す本文");

    await page.getByTestId("PageMenu.button").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("PageMenu.exportMarkdown").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${title}.md`);
    const markdown = readFileSync(await file.path(), "utf8");
    expect(markdown).toContain(`# ${title}`);
    expect(markdown).toContain("書き出す本文");

    await trashOpenPage(page);
  });

  test("PDF で書き出すと、PDF ファイルが落ちてくる", async ({ page }) => {
    // The first export downloads the compiler (~26MB) and the fonts.
    test.setTimeout(240_000);
    const { title } = await createPage(page, "E2E PDF");
    await typeInBody(page, "PDF にする日本語の本文");

    await page.getByTestId("PageMenu.button").click();
    const download = page.waitForEvent("download", { timeout: 200_000 });
    await page.getByTestId("PageMenu.exportPdf").click();
    await expect(page.getByTestId("EditorBody.status")).toBeVisible();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${title}.pdf`);
    const bytes = readFileSync(await file.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
    // No error dialog.
    await expect(page.getByTestId("AppDialog")).toHaveCount(0);

    await trashOpenPage(page);
  });

  test("印刷では、左ペインとページのメニューが出ない", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    await expect(page.getByTestId("AppShell.sidebar")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("AppShell.sidebar")).toBeHidden();
    await expect(page.getByTestId("PageMenu.button")).toBeHidden();
    await expect(editorBody(page)).toBeVisible();
  });
});