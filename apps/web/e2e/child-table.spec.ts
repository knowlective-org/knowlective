import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("Child page table", () => {
  test("a text column over several lines keeps its line breaks", async ({ page }) => {
    await createPage(page, "E2E 複数行テキスト");
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
    await page.getByTestId("AddColumnForm.nameInput").fill("メモ");
    await expect(page.getByTestId("AddColumnForm.typeSelect").locator("option")).toContainText(["複数行テキスト"]);
    await page.getByTestId("AddColumnForm.typeSelect").selectOption("LONG_TEXT");
    await page.getByTestId("AddColumnForm.submitButton").click();

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
});
