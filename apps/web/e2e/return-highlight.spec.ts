import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// Coming back to a screen after following a link on it: what was followed is
// marked for a moment.
test("going back to a child page table marks the row that was opened", async ({ page }) => {
  await createPage(page, "E2E 戻ったときの印");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/table");
  await page.getByRole("option", { name: /子ページテーブル/ }).click();
  // The input stays open for the next title.
  await page.getByTestId("ChildTableBlock.newPageButton").click();
  const rows = page.getByTestId("ChildTableBlock.row");
  for (const [i, title] of ["一つ目", "二つ目"].entries()) {
    await page.getByTestId("ChildTableBlock.newPageInput").fill(title);
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(i + 1);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ReturnHighlight.mark")).toHaveCount(0);

  await rows.nth(1).getByTestId("ChildTableBlock.pageLink").click();
  await expect(page.getByTestId("TitleField")).toHaveValue("二つ目");
  // Not on the page opened.
  await expect(page.getByTestId("ReturnHighlight.mark")).toHaveCount(0);

  await page.goBack();
  const mark = page.getByTestId("ReturnHighlight.mark");
  await expect(mark).toBeVisible();
  const [markBox, rowBox] = [await mark.boundingBox(), await rows.nth(1).boundingBox()];
  expect(Math.abs((markBox?.y ?? 0) - (rowBox?.y ?? 0))).toBeLessThan(8);
  // For a moment, and only once.
  await expect(mark).toHaveCount(0, { timeout: 5000 });
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("ReturnHighlight.mark")).toHaveCount(0);
  await trashOpenPage(page);
});
