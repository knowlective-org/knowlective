import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// Review threads beside the page (components/editor/review-pane.tsx): a chat
// about one top-level block, started from its ⋮⋮ menu, outside the document.
test.use({ storageState: authFile("editor") });

const block = (page: Page, text: string) => editorBody(page).locator(".bn-block-content", { hasText: text });

async function openMenu(page: Page, text: string) {
  await block(page, text).hover();
  await page.locator(".bn-side-menu [draggable=true]").click();
}

test("a chat about a block, beside the page: marked on the block, resolved and reopened, seen by others, never printed", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E レビュー");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("レビューしてほしい段落");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ほかの段落");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  // A nested block has no such item; a top-level one does.
  await openMenu(page, "ほかの段落");
  await expect(page.getByTestId("BlockMenu.copyItem")).toBeVisible();
  await expect(page.getByTestId("BlockMenu.reviewItem")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await openMenu(page, "レビューしてほしい段落");
  await expect(page.getByTestId("BlockMenu.reviewItem")).toHaveText("チャットを開始");
  await page.getByTestId("BlockMenu.reviewItem").click();

  const pane = page.getByTestId("ReviewPane");
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId("ReviewPane.blockText")).toHaveText("レビューしてほしい段落");
  // Beside the page, not in the document.
  const doc = (await editorBody(page).boundingBox())!;
  const side = (await pane.boundingBox())!;
  expect(side.x).toBeGreaterThanOrEqual(doc.x + doc.width - 1);
  await expect(editorBody(page).getByTestId("ReviewPane")).toHaveCount(0);

  await pane.getByTestId("ChatBlock.messageInput").fill("ここの表現を確認してください");
  await pane.getByTestId("ChatBlock.sendButton").click();
  await expect(pane.getByTestId("ChatBlock.messageRow")).toHaveCount(1);
  const marker = page.locator(`[data-ui="ReviewMarkers.button"]`);
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText("1");
  // Not part of the page's text, nor its export.
  await expect(editorBody(page)).not.toContainText("ここの表現");

  // Someone else with the page open sees the mark, and the thread from it.
  const otherContext = await browser.newContext({ storageState: authFile("admin") });
  try {
    const other = await otherContext.newPage();
    await openPage(other, id);
    const theirMarker = other.locator('[data-ui="ReviewMarkers.button"]');
    await expect(theirMarker).toHaveText("1");
    await theirMarker.click();
    await expect(other.getByTestId("ReviewPane").getByTestId("ChatBlock.text")).toHaveText("ここの表現を確認してください");
    await other.getByTestId("ReviewPane").getByTestId("ChatBlock.messageInput").fill("確認しました");
    await other.getByTestId("ReviewPane").getByTestId("ChatBlock.sendButton").click();
    // The first editor sees it without reloading.
    await expect(pane.getByTestId("ChatBlock.messageRow")).toHaveCount(2);
    await expect(marker).toHaveText("2");

    // Resolved: the pane closes and the mark goes. Someone with it open
    // sees it resolved; the mark goes when they close it.
    await pane.getByTestId("ReviewPane.resolveButton").click();
    await expect(pane).toHaveCount(0);
    await expect(marker).toHaveCount(0);
    await expect(other.getByTestId("ReviewPane.resolvedStatus")).toBeVisible();
    await other.getByTestId("ReviewPane.closeButton").click();
    await expect(theirMarker).toHaveCount(0);

    // Still opened from the menu, resolved; reopened.
    await openMenu(page, "レビューしてほしい段落");
    await expect(page.getByTestId("BlockMenu.reviewItem")).toHaveText("チャットを開く");
    await page.getByTestId("BlockMenu.reviewItem").click();
    await expect(pane.getByTestId("ReviewPane.resolvedStatus")).toBeVisible();
    await pane.getByTestId("ReviewPane.reopenButton").click();
    await expect(pane.getByTestId("ReviewPane.resolvedStatus")).toHaveCount(0);
    await expect(marker).toHaveText("2");
    await expect(theirMarker).toHaveText("2");
  } finally {
    await otherContext.close();
  }

  // Printed: the page alone.
  await page.emulateMedia({ media: "print" });
  await expect(pane).toBeHidden();
  await expect(marker).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Closed with ×.
  await pane.getByTestId("ReviewPane.closeButton").click();
  await expect(pane).toHaveCount(0);
  await expect(marker).toHaveCount(1);
  await trashOpenPage(page);
});

test("someone who can only view the page reads a thread but can't post or resolve", async ({ page, browser }) => {
  const { id } = await createPage(page, "E2E レビューの閲覧");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("見てもらう段落");
  await openMenu(page, "見てもらう段落");
  await page.getByTestId("BlockMenu.reviewItem").click();
  await page.getByTestId("ReviewPane").getByTestId("ChatBlock.messageInput").fill("閲覧者にも見える");
  await page.getByTestId("ReviewPane").getByTestId("ChatBlock.sendButton").click();
  await expect(page.locator('[data-ui="ReviewMarkers.button"]')).toHaveText("1");

  const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
  try {
    const viewer = await viewerContext.newPage();
    await openPage(viewer, id);
    await viewer.locator('[data-ui="ReviewMarkers.button"]').click();
    const pane = viewer.getByTestId("ReviewPane");
    await expect(pane.getByTestId("ChatBlock.text")).toHaveText("閲覧者にも見える");
    await expect(pane.getByTestId("ChatBlock.messageInput")).toHaveCount(0);
    await expect(pane.getByTestId("ReviewPane.resolveButton")).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
  await trashOpenPage(page);
});
