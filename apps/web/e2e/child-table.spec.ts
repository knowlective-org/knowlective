import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// A page with a child page table holding one child page, and a column of
// `type` named `name`.
async function tableWithColumn(page: Page, label: string, name: string, type: string) {
  await createPage(page, label);
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/table");
  await page.getByRole("option", { name: /子ページテーブル/ }).click();

  await page.getByTestId("ChildTableBlock.newPageButton").click();
  await page.getByTestId("ChildTableBlock.newPageInput").fill("子ページ");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ChildTableBlock.row")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.getByTestId("ChildTableBlock.addColumn").click();
  await page.getByTestId("AddColumnForm.nameInput").fill(name);
  await page.getByTestId("AddColumnForm.typeSelect").selectOption(type);
  await page.getByTestId("AddColumnForm.submitButton").click();
}

test.describe("Child page table", () => {
  test("a text column over several lines keeps its line breaks", async ({ page }) => {
    await tableWithColumn(page, "E2E 複数行テキスト", "メモ", "LONG_TEXT");
    await expect(page.getByTestId("AddColumnForm.typeSelect")).toHaveCount(0);

    // Enter starts a new line; Ctrl+Enter saves.
    const cell = page.getByTestId("LongTextCell");
    await cell.click();
    await page.keyboard.type("一行目");
    await page.keyboard.press("Enter");
    await page.keyboard.type("二行目");
    await page.keyboard.press("Control+Enter");
    await expect(cell).not.toBeFocused();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("LongTextCell")).toHaveValue("一行目\n二行目");
    await trashOpenPage(page);
  });

  test("a long text shows its first 200 characters whole", async ({ page }) => {
    await tableWithColumn(page, "E2E 長いテキスト", "メモ", "LONG_TEXT");
    const cell = page.getByTestId("LongTextCell");
    await cell.click();
    // One line of 200 characters, no line breaks.
    await page.keyboard.insertText("あ".repeat(199) + "末");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.reload();
    const fits = await page.getByTestId("LongTextCell").evaluate((el: HTMLTextAreaElement) => el.scrollHeight <= el.clientHeight + 1);
    expect(fits).toBe(true);
    await trashOpenPage(page);
  });

  test("saving a select column's options says so", async ({ page }) => {
    await tableWithColumn(page, "E2E 選択肢の保存", "状態", "SELECT");
    // The new column (first after the title) is drawn once the table has
    // reloaded; open its menu then.
    await expect(page.getByTestId("ChildTableBlock.row").locator("select")).toBeVisible();
    const editor = page.getByTestId("OptionsEditor");
    await expect(async () => {
      await page.getByTestId("ChildTableBlock.columnMenu").first().click();
      await expect(editor).toBeVisible({ timeout: 2000 });
    }).toPass();
    await editor.getByTestId("OptionsEditor.addButton").click();
    await editor.getByTestId("OptionsEditor.nameInput").last().fill("確認中");
    await expect(editor.getByTestId("OptionsEditor.status")).toHaveText("まだ保存していません");
    await editor.getByTestId("OptionsEditor.saveButton").click();
    await expect(editor.getByTestId("OptionsEditor.status")).toHaveText("✓ 保存しました");
    await expect(editor.getByTestId("OptionsEditor.saveButton")).toBeDisabled();
    // The cell offers the new option.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ChildTableBlock.row").locator("select option")).toContainText(["確認中"]);
    await trashOpenPage(page);
  });

  test("filters and sort are each person's own, saved to their account", async ({ page, browser }) => {
    const { id } = await createPage(page, "E2E フィルター");
    await editorBody(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("/table");
    await page.getByRole("option", { name: /子ページテーブル/ }).click();
    await page.getByTestId("ChildTableBlock.newPageButton").click();
    for (const name of ["議事録 10月", "報告書", "議事録 11月"]) {
      await page.getByTestId("ChildTableBlock.newPageInput").fill(name);
      await page.keyboard.press("Enter");
    }
    const rows = page.getByTestId("ChildTableBlock.row");
    await expect(rows).toHaveCount(3);
    await page.keyboard.press("Escape");

    // Filtered by title.
    await page.getByTestId("ChildTableBlock.filterMenu").click();
    await page.locator('[data-ui="FilterPanel.textInput"][data-key="title"]').fill("議事録");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("ChildTableBlock.viewStatus")).toContainText("3 件中 2 件");
    await page.keyboard.press("Escape");
    // Sorted by title, descending (two clicks): "11月" before "10月".
    await page.getByRole("columnheader").first().getByRole("button").first().click();
    await page.getByRole("columnheader").first().getByRole("button").first().click();
    await expect(rows.first()).toContainText("議事録 11月");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.waitForTimeout(1500);

    // Still there after a reload (from the account).
    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("議事録 11月");
    await expect(page.getByTestId("ChildTableBlock.filterMenu")).toHaveText("フィルター（1）");

    // Someone else sees the whole table, in its own order.
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    try {
      const viewer = await viewerContext.newPage();
      await openPage(viewer, id);
      await expect(viewer.getByTestId("ChildTableBlock.row")).toHaveCount(3);
      await expect(viewer.getByTestId("ChildTableBlock.row").first()).toContainText("議事録 10月");
      await expect(viewer.getByTestId("ChildTableBlock.viewStatus")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }

    // An editor can make their sort the table's; back to the table's view
    // keeps that sort and drops the filter.
    await page.getByTestId("ChildTableBlock.setDefaultSortButton").click();
    await page.getByTestId("ChildTableBlock.resetViewButton").click();
    // Descending by title, in Japanese order (報 after 議).
    await expect(page.getByTestId("ChildTableBlock.pageLink")).toHaveText(["📄報告書", "📄議事録 11月", "📄議事録 10月"]);
    await expect(page.getByTestId("ChildTableBlock.viewStatus")).toHaveCount(0);
    await trashOpenPage(page);
  });
});
