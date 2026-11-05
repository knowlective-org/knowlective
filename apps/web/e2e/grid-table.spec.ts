import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

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

    await cellText(page, 0).click();
    await page.keyboard.type("項目");
    await cellText(page, 3).click();
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
    await cellText(page, 4).click();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    // At the end of the text (End right after the click can be lost).
    await expect(async () => {
      await cellText(page, 0).click();
      await page.keyboard.press("End");
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
    // A row at the end, from the bar; then the last row deleted.
    await page.getByTestId("GridTable.addRowButton").click();
    await expect(rows(page)).toHaveCount(4);
    await cells(page).last().hover();
    await cells(page).last().getByTestId("GridTable.cellMenuButton").click();
    await page.getByTestId("GridTable.deleteRowItem").click();
    await expect(rows(page)).toHaveCount(3);

    // Row titles: the first column.
    await page.getByTestId("GridTable.headerColumnCheckbox").check();
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
      await expect(viewer.getByTestId("GridTable.toolbar")).toHaveCount(0);
      await expect(viewer.getByTestId("GridTable.cellMenuButton")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }

    // Deleting the table (after a confirmation) leaves an empty paragraph.
    await page.getByTestId("GridTable.deleteButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("GridTable")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
});
