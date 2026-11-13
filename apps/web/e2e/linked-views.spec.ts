import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// Linked views (lib/linked-views.ts): a child page table, board or calendar
// on one page showing another page's child pages, with that page's columns.

// A page with a child page table: one child page and a text column "担当".
async function sourcePage(page: Page) {
  const source = await createPage(page, "E2E リンク元");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/子ページテーブル");
  await page.getByRole("option", { name: /^子ページテーブル/ }).click();
  await page.getByTestId("ChildTableBlock.newPageButton").click();
  await page.getByTestId("ChildTableBlock.newPageInput").fill("リンク元の子ページ");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ChildTableBlock.row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByTestId("ChildTableBlock.addColumn").click();
  await page.getByTestId("AddColumnForm.nameInput").fill("担当");
  await page.getByTestId("AddColumnForm.submitButton").click();
  await expect(page.getByTestId("ChildTableBlock.row").locator("input")).toHaveCount(1);
  return source;
}

// Inserts a linked view from the slash menu and picks `sourceId` in the
// picker that opens with it.
async function insertLinked(page: Page, item: string, sourceId: string) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`/${item}`);
  await page.getByRole("option", { name: new RegExp(`^${item}`) }).click();
  await expect(page.getByTestId("PagePickerDialog")).toBeVisible();
  await page.getByTestId("PagePickerDialog.pageSelect").selectOption(sourceId);
  await page.getByTestId("PagePickerDialog.submitButton").click();
  await expect(page.locator(`[data-ui="LinkedSource.sourceLink"][data-id="${sourceId}"]`)).toBeVisible();
}

test.describe("Linked views", () => {
  test("a linked table shows another page's child pages, changes them and adds to them, but not its columns", async ({ page, context }) => {
    const source = await sourcePage(page);
    const sourceUrl = page.url();
    const linking = await createPage(page, "E2E リンクテーブル");
    const linkingUrl = page.url();
    await insertLinked(page, "リンクテーブル", source.id);

    const table = page.getByTestId("ChildTableBlock");
    const row = table.getByTestId("ChildTableBlock.row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("リンク元の子ページ");
    // The columns are the source's, and changed only there.
    await expect(table.getByRole("columnheader", { name: /担当/ })).toBeVisible();
    await expect(table.getByTestId("ChildTableBlock.addColumn")).toHaveCount(0);

    // A value set here is the source's child page's.
    const cell = row.locator("input").first();
    await cell.fill("山田");
    await cell.press("Enter");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // A page added here goes under the source.
    await table.getByTestId("ChildTableBlock.newPageButton").click();
    await table.getByTestId("ChildTableBlock.newPageInput").fill("リンクから追加");
    await page.keyboard.press("Enter");
    await expect(row).toHaveCount(2);
    await page.keyboard.press("Escape");

    await page.goto(sourceUrl);
    const sourceRows = page.getByTestId("ChildTableBlock.row");
    await expect(sourceRows).toHaveCount(2);
    await expect(sourceRows.filter({ hasText: "リンク元の子ページ" }).locator("input").first()).toHaveValue("山田");
    await expect(sourceRows.filter({ hasText: "リンクから追加" })).toHaveCount(1);

    // A change on the source shows on the linking page as it's made (sent
    // there too, PageLinkedView).
    const other = await context.newPage();
    await openPage(other, linking.id);
    await expect(other.getByTestId("ChildTableBlock.row")).toHaveCount(2);
    const sourceCell = sourceRows.filter({ hasText: "リンク元の子ページ" }).locator("input").first();
    await sourceCell.fill("佐藤");
    await sourceCell.press("Enter");
    await expect(
      other.getByTestId("ChildTableBlock.row").filter({ hasText: "リンク元の子ページ" }).locator("input").first(),
    ).toHaveValue("佐藤");
    await other.close();

    await page.goto(linkingUrl);
    await expect(page.getByTestId("ChildTableBlock.row")).toHaveCount(2);
    await trashOpenPage(page);
    await page.goto(sourceUrl);
    await trashOpenPage(page);
  });

  test("a child page shows its values while a linked view shows them, the source's own table gone", async ({ page }) => {
    const source = await sourcePage(page);
    const sourceUrl = page.url();
    const cell = page.getByTestId("ChildTableBlock.row").locator("input").first();
    await cell.fill("営業部");
    await cell.press("Enter");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.getByTestId("ChildTableBlock.pageLink").click();
    await expect(page.getByTestId("TitleField")).toHaveValue("リンク元の子ページ");
    const childUrl = page.url();

    await createPage(page, "E2E リンクボード");
    const linkingUrl = page.url();
    await insertLinked(page, "リンクボード", source.id);
    // No select column on the source: none is made from here.
    await expect(page.getByTestId("ChildBoardBlock")).toContainText("列はそのページで追加します");
    await expect(page.getByTestId("ChildBoardBlock.createStatusButton")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // The source's own table taken away: the linked view still shows the
    // columns, so the child page keeps its values under its title.
    await page.goto(sourceUrl);
    await page.getByTestId("ChildTableBlock").hover();
    await page.locator(".bn-side-menu [draggable=true]").click();
    await page.getByRole("menuitem", { name: "削除", exact: true }).click();
    await expect(page.getByTestId("ChildTableBlock")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.goto(childUrl);
    await expect(page.getByTestId("PageProperties.row").locator("input")).toHaveValue("営業部");

    await page.goto(linkingUrl);
    await trashOpenPage(page);
    await page.goto(sourceUrl);
    await trashOpenPage(page);
  });

  test("a linked calendar whose page isn't chosen yet asks for one", async ({ page }) => {
    await createPage(page, "E2E リンクカレンダー");
    await editorBody(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("/リンクカレンダー");
    await page.getByRole("option", { name: /^リンクカレンダー/ }).click();
    await page.getByTestId("PagePickerDialog.cancelButton").click();
    const calendar = page.getByTestId("ChildCalendarBlock");
    await expect(calendar.getByTestId("LinkedSource.status")).toBeVisible();
    // Not this page's own child pages.
    await expect(calendar.getByTestId("ChildCalendarBlock.createDateButton")).toHaveCount(0);
    await calendar.getByTestId("LinkedSource.chooseButton").click();
    await expect(page.getByTestId("PagePickerDialog")).toBeVisible();
    await page.getByTestId("PagePickerDialog.cancelButton").click();
    await trashOpenPage(page);
  });
});
