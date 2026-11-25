import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { clickInEditor, createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// The extended table: cells holding blocks, header row and row titles, rows
// and columns added and deleted, widths dragged.
test.use({ storageState: authFile("editor") });

async function insertGridTable(page: import("@playwright/test").Page) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/拡張テーブル");
  await page.getByRole("option", { name: /拡張テーブル/ }).click();
  await expect(page.getByTestId("GridTable")).toBeVisible();
}

const rows = (page: import("@playwright/test").Page) => page.locator('[data-ui="GridTable"] .kn-grid-row');
const cells = (page: import("@playwright/test").Page) => page.getByTestId("GridTable.cell");
const cellContent = (page: import("@playwright/test").Page, i: number) => cells(page).nth(i).locator(".kn-grid-cell-content");
const cellText = (page: import("@playwright/test").Page, i: number) => cells(page).nth(i).locator(".bn-inline-content").first();

test.describe("Extended table", () => {
  test("cells hold blocks, keep them, and the table's rows and columns change", async ({ page, browser }) => {
    const { id } = await createPage(page, "E2E 拡張テーブル");
    await insertGridTable(page);
    await expect(rows(page)).toHaveCount(3);
    await expect(cells(page)).toHaveCount(9);
    // The first row is the headings.
    await expect(cells(page).nth(0)).toHaveAttribute("role", "columnheader");
    await expect(cells(page).nth(3)).toHaveAttribute("role", "cell");

    await clickInEditor(cellText(page, 0));
    await page.keyboard.type("項目");
    await clickInEditor(cellText(page, 3));
    await page.keyboard.type("説明");
    // More blocks in the same cell: a list.
    await page.keyboard.press("Enter");
    await page.keyboard.type("- 一つ目");
    await page.keyboard.press("Enter");
    await page.keyboard.type("二つ目");
    await expect(cells(page).nth(3).locator('[data-content-type="bulletListItem"]')).toHaveCount(2);
    await expect(cells(page).nth(3).locator('[data-content-type="paragraph"]')).toHaveText("説明");

    // Backspace at the start of a cell, and Delete at the end of one, leave
    // the cells as they are.
    await clickInEditor(cellText(page, 4));
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    // At the end of the text: a click past it, at the right of the line. (A
    // click on the text and then End isn't enough: on a busy machine, the
    // editor can apply the click's caret after End and put it back.)
    await expect(async () => {
      const box = (await cellText(page, 0).boundingBox())!;
      await cellText(page, 0).click({ position: { x: box.width - 2, y: box.height / 2 } });
      const atEnd = await page.evaluate(() => {
        const s = window.getSelection();
        return !!s?.isCollapsed && s.focusNode?.textContent === "項目" && s.focusOffset === 2;
      });
      expect(atEnd).toBe(true);
    }).toPass();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Delete");
    await expect(cells(page)).toHaveCount(9);
    await expect(cellContent(page, 0)).toHaveText("項目");
    await expect(cells(page).nth(3).locator('[data-content-type="bulletListItem"]')).toHaveCount(2);

    // A column to the right of the first, from a cell's menu.
    await cells(page).nth(0).hover();
    await cells(page).nth(0).getByTestId("GridTable.cellMenuButton").click();
    await page.getByTestId("GridTable.insertColumnRightItem").click();
    await expect(cells(page)).toHaveCount(12);
    await expect(rows(page).nth(1).getByTestId("GridTable.cell")).toHaveCount(4);
    await expect(cellContent(page, 4)).toContainText("説明");
    // A row at the end, from the table's menu; then the last row deleted.
    await page.getByTestId("GridTable.menuButton").click();
    await page.getByTestId("GridTable.addRowItem").click();
    await expect(rows(page)).toHaveCount(4);
    await cells(page).last().hover();
    await cells(page).last().getByTestId("GridTable.cellMenuButton").click();
    await page.getByTestId("GridTable.deleteRowItem").click();
    await expect(rows(page)).toHaveCount(3);

    // Row titles: the first column.
    await page.getByTestId("GridTable.menuButton").click();
    await page.getByTestId("GridTable.headerColumnItem").click();
    await expect(cells(page).nth(4)).toHaveAttribute("role", "rowheader");

    // Wider first column, by dragging its edge.
    const handle = cells(page).nth(0).getByTestId("GridTable.resizeHandle");
    const box = (await handle.boundingBox())!;
    const before = (await cells(page).nth(0).boundingBox())!.width;
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 10, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await cells(page).nth(0).boundingBox())!.width).toBeGreaterThan(before + 50);

    // All of it saved.
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(cells(page)).toHaveCount(12);
    await expect(cells(page).nth(4).locator('[data-content-type="bulletListItem"]')).toHaveCount(2);
    await expect(cells(page).nth(4)).toHaveAttribute("role", "rowheader");
    expect((await cells(page).nth(0).boundingBox())!.width).toBeGreaterThan(before + 50);

    // Someone who can only view the page: the table, without its controls.
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    try {
      const viewer = await viewerContext.newPage();
      await openPage(viewer, id);
      await expect(viewer.getByTestId("GridTable.cell")).toHaveCount(12);
      await expect(viewer.locator(".kn-grid-cell-content").nth(0)).toHaveText("項目");
      await expect(viewer.getByTestId("GridTable.menuButton")).toHaveCount(0);
      await expect(viewer.getByTestId("GridTable.cellMenuButton")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }

    // Deleting the table (after a confirmation) leaves an empty paragraph.
    await page.getByTestId("GridTable.menuButton").click();
    await page.getByTestId("GridTable.deleteItem").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("GridTable")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("↓ and ↑ move to the cell below and above, in the same column; out of the table from its last and first row", async ({ page }) => {
    await createPage(page, "E2E 拡張テーブルの上下");
    await insertGridTable(page);
    // The middle column, its first row (cells: 0 1 2 / 3 4 5 / 6 7 8).
    await clickInEditor(cellText(page, 1));
    await page.keyboard.type("上");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("中");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("下");
    await expect(cellText(page, 4)).toHaveText("中");
    await expect(cellText(page, 7)).toHaveText("下");
    await expect(cellText(page, 2)).toHaveText("");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("!");
    await expect(cellText(page, 1)).toHaveText("上!");
    // From the last row: below the table.
    await clickInEditor(cellText(page, 7));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("表の下");
    await expect(editorBody(page).locator('[data-content-type="paragraph"]').filter({ hasText: "表の下" })).toHaveCount(1);
    await expect(cells(page).filter({ hasText: "表の下" })).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("Tab goes to the next cell as in a table, unless the block has a Tab of its own", async ({ page }) => {
    await createPage(page, "E2E 拡張テーブルの Tab");
    await insertGridTable(page);
    // (cells: 0 1 2 / 3 4 5 / 6 7 8)
    await clickInEditor(cellText(page, 0));
    await page.keyboard.type("左");
    // With text in the cell too: the cell to the right.
    await page.keyboard.press("Tab");
    await page.keyboard.type("右");
    await expect(cellText(page, 1)).toHaveText("右");
    await expect(cellText(page, 0)).toHaveText("左");
    // The last column: the first cell of the next row.
    await clickInEditor(cellText(page, 2));
    await page.keyboard.press("Tab");
    await page.keyboard.type("下");
    await expect(cellText(page, 3)).toHaveText("下");
    await expect(cellText(page, 5)).toHaveText("");
    // Shift+Tab: back to the last cell of the row above, its content selected.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("戻");
    await expect(cellText(page, 2)).toHaveText("戻");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.type("中");
    await expect(cellText(page, 1)).toHaveText("中");
    // The last cell: nowhere to go, it stays (and the focus stays in the editor).
    await clickInEditor(cellText(page, 8));
    await page.keyboard.type("端");
    await page.keyboard.press("Tab");
    await page.keyboard.type("!");
    await expect(cellText(page, 8)).toHaveText("端!");
    // A list item with one above it: nested, as in the page.
    await clickInEditor(cellText(page, 4));
    await page.keyboard.type("- 一");
    await page.keyboard.press("Enter");
    await page.keyboard.type("二");
    await page.keyboard.press("Tab");
    const nested = cells(page).nth(4).locator('.bn-block-group [data-content-type="bulletListItem"]');
    await expect(nested).toHaveText("二");
    await expect(cellText(page, 5)).toHaveText("");
    // Shift+Tab takes it back out, still in the cell.
    await page.keyboard.press("Shift+Tab");
    await expect(nested).toHaveCount(0);
    await expect(cells(page).nth(4).locator('[data-content-type="bulletListItem"]')).toHaveText(["一", "二"]);
    // The first item has nothing to nest under: the next cell.
    await clickInEditor(cells(page).nth(4).locator('[data-content-type="bulletListItem"] .bn-inline-content').first());
    await page.keyboard.press("Tab");
    await page.keyboard.type("隣");
    await expect(cellText(page, 5)).toHaveText("隣");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("table data pasted into a cell fills the cells from there, adding the columns it needs", async ({ page }) => {
    await createPage(page, "E2E 拡張テーブルへの貼り付け");
    await insertGridTable(page);
    // (A moment after the table went in: an undo taken within half a second
    // of another change takes both back.)
    await page.waitForTimeout(800);
    // From the middle cell (row 2, column 2): 2 rows × 3 columns, so a 4th column.
    await clickInEditor(cellText(page, 4));
    // (The caret in that cell before the paste: a key typed there lands there.)
    await page.keyboard.type("x");
    await expect(cellContent(page, 4)).toHaveText("x");
    await page.keyboard.press("Backspace");
    await expect(cellContent(page, 4)).toHaveText("");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/html", "<table><tr><td>A1</td><td>B1</td><td>C1</td></tr><tr><td>A2</td><td>B2<br>二行目</td><td>C2</td></tr></table>");
      data.setData("text/plain", "A1\tB1\tC1\nA2\tB2\tC2");
      document.querySelector(".bn-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(cells(page)).toHaveCount(12);
    // Rows of 4: 0-3, 4-7, 8-11.
    await expect(cellContent(page, 5)).toHaveText("A1");
    await expect(cellContent(page, 6)).toHaveText("B1");
    await expect(cellContent(page, 7)).toHaveText("C1");
    await expect(cellContent(page, 9)).toHaveText("A2");
    await expect(cells(page).nth(10).locator('[data-content-type="paragraph"]')).toHaveText(["B2", "二行目"]);
    await expect(cellContent(page, 11)).toHaveText("C2");
    // Nothing else came in: no BlockNote table.
    await expect(editorBody(page).locator('[data-content-type="table"]')).toHaveCount(0);
    // One undo takes it back.
    await page.keyboard.press("Control+z");
    await expect(cells(page)).toHaveCount(9);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("the table's ⋮⋮ duplicates and deletes it", async ({ page }) => {
    await createPage(page, "E2E 拡張テーブルのハンドル");
    await insertGridTable(page);
    await clickInEditor(cellText(page, 0));
    await page.keyboard.type("元の表");
    const tables = page.getByTestId("GridTable");
    await tables.first().hover();
    await tables.first().getByTestId("GridTable.handle").click();
    await page.getByTestId("GridTable.duplicateItem").click();
    await expect(tables).toHaveCount(2);
    await expect(tables.nth(1)).toContainText("元の表");
    await tables.nth(1).hover();
    await tables.nth(1).getByTestId("GridTable.handle").click();
    await page.getByTestId("GridTable.deleteItem").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(tables).toHaveCount(1);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("a column is selected with its button: copied, cleared, styled, moved and deleted", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await createPage(page, "E2E 拡張テーブルの列");
    await insertGridTable(page);
    // The middle column: 上 / 中 / 下 (cells 1, 4, 7).
    for (const [i, text] of [[1, "上"], [4, "中"], [7, "下"], [0, "左"]] as const) {
      await cellText(page, i).click();
      await page.keyboard.type(text);
    }
    const columnButton = (col: number) => cells(page).nth(col).getByTestId("GridTable.columnButton");
    await cells(page).nth(1).hover();
    await columnButton(1).click();
    await expect(page.locator(".kn-grid-col-selected")).toHaveCount(3);
    // Copy (from the menu): the column's lines.
    await page.getByTestId("GridTable.copyColumnItem").click();
    // (Windows' clipboard gives the lines back with CRLF.)
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"))).toBe("上\n中\n下");

    // Its text in red.
    await cells(page).nth(1).hover();
    await columnButton(1).click();
    await page.getByTestId("GridTable.columnTextColorItem").click();
    await page.getByTestId("GridTable.columnColorItem").filter({ hasText: "赤" }).click();
    for (const i of [1, 4, 7]) await expect(cells(page).nth(i).locator("[data-text-color]")).toHaveAttribute("data-text-color", "red");

    // Moved left (before the first column).
    await cells(page).nth(1).hover();
    await columnButton(1).click();
    await page.getByTestId("GridTable.moveColumnLeftItem").click();
    await expect(cellContent(page, 0)).toHaveText("上");
    await expect(cellContent(page, 1)).toHaveText("左");
    await expect(cellContent(page, 3)).toHaveText("中");

    // Dragged back to the middle.
    await cells(page).nth(0).hover();
    const from = (await columnButton(0).boundingBox())!;
    const to = (await cells(page).nth(1).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(cellContent(page, 0)).toHaveText("左");
    await expect(cellContent(page, 1)).toHaveText("上");

    // Cleared with Delete while selected (the menu closed with Esc).
    await cells(page).nth(1).hover();
    await columnButton(1).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    for (const i of [1, 4, 7]) await expect(cellContent(page, i)).toHaveText("");
    await expect(cellContent(page, 0)).toHaveText("左");

    // Deleted.
    await cells(page).nth(1).hover();
    await columnButton(1).click();
    await page.getByTestId("GridTable.deleteColumnItem").click();
    await expect(cells(page)).toHaveCount(6);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
});

test("a summary row adds up its columns: sums, counts and conditions (COUNTIF, SUMIF)", async ({ page }) => {
  await createPage(page, "E2E 拡張テーブルの集計");
  await insertGridTable(page);
  // Two columns of the three: item, amount, status; header row + 2 body rows (+1 added).
  await page.getByTestId("GridTable.menuButton").click();
  await page.getByTestId("GridTable.addRowItem").click();
  await expect(cells(page)).toHaveCount(12);
  const values = ["品目", "金額", "状態", "りんご", "1,200", "完了", "みかん", "300", "未着手", "ぶどう", "500", "完了"];
  for (const [i, value] of values.entries()) {
    await cellText(page, i).click();
    await page.keyboard.type(value);
  }

  await page.getByTestId("GridTable.menuButton").click();
  await page.getByTestId("GridTable.summaryRowItem").click();
  const summary = page.getByTestId("GridTable.summaryRow");
  await expect(summary).toBeVisible();
  const summaryCell = (col: number) => summary.locator(`[data-ui="GridTable.summaryCell"][data-col="${col}"]`);

  // Sum of the amounts (the header row isn't counted).
  await summaryCell(1).click();
  await page.getByTestId("GridTable.summaryFunctionSelect").selectOption("sum");
  await page.getByTestId("GridTable.summaryApplyButton").click();
  await expect(summaryCell(1).getByTestId("GridTable.summaryValue")).toHaveText("2,000");

  // How many are done.
  await summaryCell(2).click();
  await page.getByTestId("GridTable.summaryFunctionSelect").selectOption("countif");
  await page.getByTestId("GridTable.summaryCriteriaInput").fill("完了");
  await page.getByTestId("GridTable.summaryApplyButton").click();
  await expect(summaryCell(2).getByTestId("GridTable.summaryValue")).toHaveText("2");

  // The amounts of the rows that are done: SUMIF on the status column.
  await summaryCell(1).click();
  await page.getByTestId("GridTable.summaryFunctionSelect").selectOption("sumif");
  await page.getByTestId("GridTable.summaryCriteriaInput").fill("完了");
  await page.getByTestId("GridTable.summaryRangeSelect").selectOption("2");
  await page.getByTestId("GridTable.summaryApplyButton").click();
  await expect(summaryCell(1).getByTestId("GridTable.summaryValue")).toHaveText("1,700");

  // It follows the cells as they change.
  await clickInEditor(cellText(page, 8));
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("完了");
  await expect(summaryCell(2).getByTestId("GridTable.summaryValue")).toHaveText("3");
  await expect(summaryCell(1).getByTestId("GridTable.summaryValue")).toHaveText("2,000");

  // Kept in the document: still there after a reload.
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("GridTable.summaryRow")).toBeVisible();
  await expect(summaryCell(2).getByTestId("GridTable.summaryValue")).toHaveText("3");

  // Turned off again.
  await page.getByTestId("GridTable.menuButton").click();
  await page.getByTestId("GridTable.summaryRowItem").click();
  await expect(page.getByTestId("GridTable.summaryRow")).toBeHidden();
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
