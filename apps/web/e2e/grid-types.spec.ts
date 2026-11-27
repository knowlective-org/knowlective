import { type Page, expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { clickInEditor, createPage, editorBody, trashOpenPage } from "./helpers";

// An extended table's columns with input rules (components/editor/grid-types.ts):
// a column made a date, options, a number, a checkbox, a person or masked
// turns its cells' text into values (asking about what can't be), and its
// cells then hold a value put in with a control.
test.use({ storageState: authFile("editor") });

async function insertGridTable(page: Page) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/拡張テーブル");
  await page.getByRole("option", { name: /拡張テーブル/ }).click();
  await expect(page.getByTestId("GridTable")).toBeVisible();
}

const cells = (page: Page) => page.getByTestId("GridTable.cell");
const cellText = (page: Page, i: number) => cells(page).nth(i).locator(".bn-inline-content").first();

async function typeIn(page: Page, i: number, text: string) {
  await clickInEditor(cellText(page, i));
  await page.keyboard.type(text);
}

async function setType(page: Page, col: number, label: string) {
  await cells(page).nth(col).hover();
  await cells(page).nth(col).getByTestId("GridTable.columnButton").click();
  await page.getByTestId("GridTable.columnTypeItem").click();
  await page.getByTestId("GridTable.columnTypeOption").filter({ hasText: label }).click();
}

test("columns with input rules: dates, options, numbers, checkboxes, people and masked values", async ({ page }) => {
  await createPage(page, "E2E 拡張テーブルの列の種類");
  await insertGridTable(page);
  // Rows 1 and 2 (row 0 is the headings): a date and something that isn't one.
  await typeIn(page, 0, "期限");
  await typeIn(page, 3, "2026/12/1");
  await typeIn(page, 6, "そのうち");
  await typeIn(page, 1, "状態");
  const heading = `合言葉列${Date.now()}`;
  await typeIn(page, 2, heading);
  await typeIn(page, 4, "進行中");
  await typeIn(page, 7, "未着手");

  // A date column: the value that isn't one is asked about, then emptied.
  await setType(page, 0, "日付");
  await expect(page.getByTestId("AppDialog.message")).toContainText("1 個のセル");
  await page.getByTestId("AppDialog.confirmButton").click();
  const dates = page.getByTestId("GridTable.dateInput");
  await expect(dates).toHaveCount(2);
  await expect(dates.nth(0)).toHaveValue("2026-12-01");
  await expect(dates.nth(1)).toHaveValue("");
  // The heading stays text.
  await expect(cellText(page, 0)).toHaveText("期限");
  await dates.nth(1).fill("2027-01-15");
  await expect(dates.nth(1)).toHaveValue("2027-01-15");

  // Options: made from the cells' words; chosen from a menu.
  await setType(page, 1, "選択肢（1つ）");
  const selects = page.getByTestId("GridTable.selectButton");
  await expect(selects.nth(0)).toHaveText("進行中");
  await expect(selects.nth(1)).toHaveText("未着手");
  await selects.nth(1).click();
  await page.getByTestId("GridTable.optionItem").filter({ hasText: "進行中" }).click();
  await expect(selects.nth(1)).toHaveText("進行中");
  // A new option, chosen at once.
  await selects.nth(0).click();
  await page.getByTestId("GridTable.newOptionItem").click();
  await page.getByTestId("AppDialog.textInput").fill("完了");
  await page.getByTestId("AppDialog.confirmButton").click();
  await expect(selects.nth(0)).toHaveText("完了");

  // Typing into a typed cell doesn't reach its hidden blocks.
  await expect(cells(page).nth(4).locator(".kn-grid-cell-content")).toBeHidden();

  // A number column (the third): its cells' values typed, checked.
  await setType(page, 2, "数値");
  const numbers = page.getByTestId("GridTable.numberInput");
  await numbers.nth(0).fill("12,000");
  await numbers.nth(0).press("Enter");
  await expect(numbers.nth(0)).toHaveValue("12000");
  await numbers.nth(1).fill("たくさん");
  await numbers.nth(1).press("Enter");
  await expect(numbers.nth(1)).toHaveAttribute("aria-invalid", "true");

  // Kept in the page's document, as the cells' text.
  await page.reload();
  await expect(page.getByTestId("GridTable.dateInput").nth(1)).toHaveValue("2027-01-15");
  await expect(page.getByTestId("GridTable.selectButton").nth(0)).toHaveText("完了");
  // Shown with separators (stored as typed); its decimals fixed from the column's menu.
  await expect(page.getByTestId("GridTable.numberInput").nth(0)).toHaveValue("12,000");
  await cells(page).nth(2).hover();
  await cells(page).nth(2).getByTestId("GridTable.columnButton").click();
  await page.getByTestId("GridTable.numberDecimalsItem").click();
  await page.locator('[data-ui="AppDialog.choiceButton"][data-id="2"]').click();
  await expect(page.getByTestId("GridTable.numberInput").nth(0)).toHaveValue("12,000.00");

  // A checkbox column.
  await setType(page, 2, "チェックボックス");
  // "12000" isn't a checkbox's: asked about, emptied.
  await page.getByTestId("AppDialog.confirmButton").click();
  const checks = page.getByTestId("GridTable.checkboxInput");
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await expect(checks.nth(0)).toBeChecked();

  // A masked column: a passphrase chosen, values typed, sealed in the document.
  await setType(page, 2, "鍵");
  // Its one value ("✓") is sealed with a new passphrase.
  await page.getByTestId("AppDialog.passphraseInput").fill("合言葉です");
  await page.getByTestId("AppDialog.passphraseAgainInput").fill("合言葉です");
  await page.getByTestId("AppDialog.confirmButton").click();
  const masked = page.getByTestId("GridTable.maskedInput");
  await expect(masked.nth(0)).toHaveValue("✓");
  await masked.nth(1).fill("秘密の値");
  await masked.nth(1).press("Enter");
  await expect(masked.nth(1)).toHaveValue("秘密の値");
  // Reloaded: hidden until the passphrase is typed.
  await page.reload();
  await expect(page.getByTestId("GridTable.maskedButton")).toHaveCount(2);
  await page.getByTestId("GridTable.maskedButton").nth(1).click();
  await page.getByTestId("AppDialog.passphraseInput").fill("合言葉です");
  await page.getByTestId("AppDialog.confirmButton").click();
  await expect(page.getByTestId("GridTable.maskedInput").nth(1)).toHaveValue("秘密の値");
  // The sealed text is in the document only, never shown.
  await expect(cells(page).nth(5).locator(".kn-grid-cell-content")).toBeHidden();
  await expect(page.getByTestId("GridTable").getByText(/^v1\./).filter({ visible: true })).toHaveCount(0);

  // Nor searched: the index has the table's text, not the sealed values.
  const sealed = (await cells(page).nth(8).locator(".kn-grid-cell-content").textContent())!;
  expect(sealed).toMatch(/^v1\./);
  const pageUrl = page.url();
  const found = () => page.locator('[data-ui="SearchPage.result"]').filter({ hasText: heading }).count();
  await expect
    .poll(
      async () => {
        await page.goto(`search?mode=keyword&q=${encodeURIComponent(heading)}`);
        return found();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe(1);
  await page.goto(`search?mode=keyword&q=${encodeURIComponent(sealed.slice(-12))}`);
  await expect(page.getByTestId("SearchPage.status")).toBeVisible();
  expect(await found()).toBe(0);
  await page.goto(pageUrl);
  await expect(page.getByTestId("GridTable")).toBeVisible();

  // A person column: the options' words aren't anyone's (asked, emptied);
  // a person chosen from the page's people, shown as a mention.
  await setType(page, 1, "ユーザー");
  await expect(page.getByTestId("AppDialog.message")).toContainText("2 個のセル");
  await page.getByTestId("AppDialog.confirmButton").click();
  const pick = page.getByTestId("GridTable.userButton");
  await expect(pick).toHaveCount(2);
  await cells(page).nth(4).hover();
  await pick.nth(0).click();
  await page.getByTestId("GridTable.personItem").filter({ hasText: ACCOUNTS.viewer.name }).click();
  await expect(cells(page).nth(4).getByTestId("Mention")).toHaveText(`@${ACCOUNTS.viewer.name}`);

  // Back to text: the dates stay as they were written.
  await setType(page, 0, "テキスト");
  await expect(cellText(page, 3)).toHaveText("2026-12-01");
  await trashOpenPage(page);
});

test("text pasted into an options cell chooses the options it names", async ({ page }) => {
  await createPage(page, "E2E 拡張テーブルの選択肢への貼り付け");
  await insertGridTable(page);
  await typeIn(page, 0, "状態");
  await typeIn(page, 3, "未着手");
  await typeIn(page, 6, "完了");
  await setType(page, 0, "選択肢（複数）");
  const selects = page.getByTestId("GridTable.selectButton");
  await expect(selects).toHaveCount(2);

  const paste = (i: number, text: string) =>
    selects.nth(i).evaluate((el, text) => {
      (el as HTMLElement).focus();
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
  // One option, then several (a line or a comma between them).
  await paste(0, "完了\r\n");
  await expect(selects.nth(0)).toHaveText("完了");
  await paste(1, "未着手, 完了");
  await expect(selects.nth(1).getByTestId("GridTable.option")).toHaveText(["未着手", "完了"]);
  // Not an option: nothing changes, and that's said.
  await paste(0, "保留");
  await expect(page.getByTestId("Notice")).toContainText("「保留」はこの列の値ではありません");
  await expect(selects.nth(0)).toHaveText("完了");
  await expect(page.getByTestId("GridTable").locator(".kn-grid-invalid")).toHaveCount(0);

  // With the caret in the cell (its blocks hidden): the same.
  await clickInEditor(cellText(page, 0));
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "未着手");
    document.querySelector(".bn-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(selects.nth(0)).toHaveText("未着手");

  await page.reload();
  await expect(page.getByTestId("GridTable.selectButton").nth(0)).toHaveText("未着手");
  await expect(page.getByTestId("GridTable.selectButton").nth(1).getByTestId("GridTable.option")).toHaveText(["未着手", "完了"]);
  await trashOpenPage(page);
});
