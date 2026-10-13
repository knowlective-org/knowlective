import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// Adds a 子ページボード to the open page through the slash menu.
async function insertBoard(page: import("@playwright/test").Page) {
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/kanban");
  await page.getByRole("option", { name: /子ページボード/ }).click();
  await expect(page.getByTestId("ChildBoardBlock")).toBeVisible();
}

const lane = (page: import("@playwright/test").Page, name: string) =>
  page.locator(`[data-ui="ChildBoardBlock.lane"][aria-label="${name}"]`);

test.describe("子ページボード", () => {
  test("ステータスを作ってカードを追加し、列を移動できる", async ({ page }) => {
    const board = await createPage(page, "E2E ボード");
    await insertBoard(page);

    // No 選択肢 column yet: the board offers to make ステータス.
    await page.getByTestId("ChildBoardBlock.createStatusButton").click();
    await expect(lane(page, "未着手")).toBeVisible();
    await expect(lane(page, "進行中")).toBeVisible();
    await expect(lane(page, "完了")).toBeVisible();

    // A card is a child page, made in the lane it's added to.
    await lane(page, "未着手").getByTestId("ChildBoardBlock.addCardButton").click();
    await page.getByTestId("ChildBoardBlock.addCardInput").fill("最初のタスク");
    await page.keyboard.press("Enter");
    const card = page.locator('[data-ui="ChildBoardBlock.card"]').filter({ hasText: "最初のタスク" });
    await expect(lane(page, "未着手").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(1);
    await expect(lane(page, "未着手").getByTestId("ChildBoardBlock.laneCount")).toHaveText("1");
    const cardId = (await card.getAttribute("data-id"))!;

    // Moved with the card's own select (the way without dragging).
    await card.getByTestId("ChildBoardBlock.cardLaneSelect").selectOption({ label: "進行中" });
    await expect(lane(page, "進行中").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(1);
    await expect(lane(page, "未着手").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(0);

    // Moved by dragging.
    // With real mouse moves in several steps: a browser only starts a drag
    // once the pointer has travelled a little.
    const from = (await card.getByTestId("ChildBoardBlock.cardLink").boundingBox())!;
    const to = (await lane(page, "完了").boundingBox())!;
    await page.mouse.move(from.x + 4, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 24, from.y + from.height / 2 + 6, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(lane(page, "完了").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(1);
    await expect(lane(page, "進行中").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(0);
    // The page's own text wasn't dragged along by the editor.
    await expect(editorBody(page).locator('[data-content-type="paragraph"]').filter({ hasText: "最初のタスク" })).toHaveCount(0);

    // Stored on the server: still there after a reload. (A move shows at once
    // and is saved just after; the board says when that is done.)
    await expect(page.getByTestId("ChildBoardBlock.board")).toHaveAttribute("aria-busy", "false");
    await page.reload();
    await expect(lane(page, "完了").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(1);

    // A new lane.
    await page.getByTestId("ChildBoardBlock.addLaneButton").click();
    await page.getByTestId("ChildBoardBlock.addLaneInput").fill("保留");
    await page.keyboard.press("Enter");
    await expect(lane(page, "保留")).toBeVisible();

    // The card opens as a page.
    await page.locator('[data-ui="ChildBoardBlock.card"]').filter({ hasText: "最初のタスク" }).getByTestId("ChildBoardBlock.cardLink").click();
    await expect(page).toHaveURL(new RegExp(`/pages/${cardId}$`));
    await expect(page.getByTestId("TitleField")).toHaveValue("最初のタスク");

    await openPage(page, board.id);
    await trashOpenPage(page);
  });

  test("閲覧のみの人には、カードは見えるが動かせない", async ({ page, browser }) => {
    const board = await createPage(page, "E2E ボード 閲覧");
    await insertBoard(page);
    await page.getByTestId("ChildBoardBlock.createStatusButton").click();
    await lane(page, "未着手").getByTestId("ChildBoardBlock.addCardButton").click();
    await page.getByTestId("ChildBoardBlock.addCardInput").fill("見るだけのカード");
    await page.keyboard.press("Enter");
    await expect(lane(page, "未着手").locator('[data-ui="ChildBoardBlock.card"]')).toHaveCount(1);
    // Let the block reach the server before someone else opens the page.
    await page.waitForTimeout(1500);

    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const viewer = await viewerContext.newPage();
    try {
      await openPage(viewer, board.id);
      const card = viewer.locator('[data-ui="ChildBoardBlock.card"]').filter({ hasText: "見るだけのカード" });
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("draggable", "false");
      await expect(viewer.getByTestId("ChildBoardBlock.cardLaneSelect")).toHaveCount(0);
      await expect(viewer.getByTestId("ChildBoardBlock.addCardButton")).toHaveCount(0);
      await expect(viewer.getByTestId("ChildBoardBlock.addLaneButton")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
    await trashOpenPage(page);
  });
});