import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// The child page list and board can be sorted: each person's own order (kept
// on their account), over the block's order, which editors can set for everyone.
test.use({ storageState: authFile("editor") });

async function insert(page: Page, query: string, option: RegExp) {
  // On the empty line at the end (a click in the middle could land in a block).
  const paragraphs = editorBody(page).locator('.bn-block-content[data-content-type="paragraph"]');
  if ((await paragraphs.count()) > 0) await paragraphs.last().click();
  else await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(query);
  await page.getByRole("option", { name: option }).first().click();
}

const TITLES = /ばなな|あんず|ちぇりー/;
const linkTitles = async (page: Page) => (await page.getByTestId("ChildPagesBlock.link").allTextContents()).map((t) => t.match(TITLES)?.[0]);
const cardTitles = async (page: Page) =>
  (await page.locator('[data-ui="ChildBoardBlock.card"]').allTextContents()).map((t) => t.match(TITLES)?.[0]);

test("the child page list and board sort by title, for oneself or for everyone", async ({ page }) => {
  await createPage(page, "E2E 子ページの並び替え");
  // Child pages, made in this order.
  await insert(page, "/table", /子ページテーブル/);
  // (The box stays open for the next one after Enter.)
  await page.getByTestId("ChildTableBlock.newPageButton").click();
  for (const title of ["ばなな", "あんず", "ちぇりー"]) {
    await page.getByTestId("ChildTableBlock.newPageInput").fill(title);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ChildTableBlock.row").filter({ hasText: title })).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await insert(page, "/子ページ一覧", /子ページ一覧/);
  await insert(page, "/kanban", /子ページボード/);
  await page.getByTestId("ChildBoardBlock.createStatusButton").click();
  await expect(page.locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(3);

  // The pages' own order at first.
  await expect.poll(() => linkTitles(page)).toEqual(["ばなな", "あんず", "ちぇりー"]);
  await expect.poll(() => cardTitles(page)).toEqual(["ばなな", "あんず", "ちぇりー"]);

  // By title, for oneself.
  await page.getByTestId("ChildPagesBlock.sortSelect").selectOption("title:asc");
  await expect.poll(() => linkTitles(page)).toEqual(["あんず", "ちぇりー", "ばなな"]);
  await page.getByTestId("ChildBoardBlock.sortSelect").selectOption("title:desc");
  await expect.poll(() => cardTitles(page)).toEqual(["ばなな", "ちぇりー", "あんず"]);

  // Kept on the account: still there after a reload.
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1000);
  await page.reload();
  await expect.poll(() => linkTitles(page)).toEqual(["あんず", "ちぇりー", "ばなな"]);
  await expect.poll(() => cardTitles(page)).toEqual(["ばなな", "ちぇりー", "あんず"]);

  // Made the list's order for everyone: no order of one's own left.
  await page.getByTestId("ChildPagesBlock.setDefaultSortButton").click();
  await expect(page.getByTestId("ChildPagesBlock.resetSortButton")).toHaveCount(0);
  await expect(page.getByTestId("ChildPagesBlock.sortSelect")).toHaveValue("title:asc");
  // The board back to its own order: the pages'.
  await page.getByTestId("ChildBoardBlock.resetSortButton").click();
  await expect.poll(() => cardTitles(page)).toEqual(["ばなな", "あんず", "ちぇりー"]);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
