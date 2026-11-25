import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { addPageFromTree, openPage, trashOpenPage } from "./helpers";

// A chat about one of a whiteboard's items (the review threads of
// components/editor/review-pane.tsx, by the item's id): started from the
// board's menu, shown over the board's right side, marked by the item.
test.use({ storageState: authFile("editor") });

async function boardPoint(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
  return { x: box.x + x, y: box.y + y };
}

const item = (page: Page, text: string) => page.getByTestId("Whiteboard.item").filter({ hasText: text });

test("a chat about a whiteboard item: started from the menu, marked by the item, seen by others, resolved", async ({ page, browser }) => {
  await openPage(page, HOME_PAGE_ID);
  await addPageFromTree(page, HOME_PAGE_ID, "whiteboard");
  await page.waitForURL((url) => /\/pages\/(?!e2e-home)[^/]+$/.test(url.pathname));
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
  await page.getByTestId("TitleField").fill(`E2E ホワイトボードのチャット ${Date.now()}`);

  await page.getByTestId("Whiteboard.stickyToolButton").click();
  const at = await boardPoint(page, 200, 200);
  await page.mouse.click(at.x, at.y);
  await page.getByTestId("Whiteboard.textInput").fill("相談したい付箋");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("Whiteboard.textInput")).toHaveCount(0);

  // The board's menu on nothing: no chat item; on the item: "start".
  const empty = await boardPoint(page, 650, 400);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(page.getByTestId("Whiteboard.contextMenu")).toBeVisible();
  await expect(page.getByTestId("Whiteboard.chatMenuItem")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const note = (await item(page, "相談したい付箋").boundingBox())!;
  await page.mouse.click(note.x + 20, note.y + 20, { button: "right" });
  await expect(page.getByTestId("Whiteboard.chatMenuItem")).toHaveText("チャットを開始");
  await page.getByTestId("Whiteboard.chatMenuItem").click();

  const pane = page.getByTestId("ReviewPane");
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId("ReviewPane.blockText")).toHaveText("相談したい付箋");
  await expect(page.getByTestId("Whiteboard.reviewFrame")).toHaveCount(1);
  await pane.getByTestId("ChatBlock.messageInput").fill("この案でよいですか");
  await pane.getByTestId("ChatBlock.sendButton").click();
  await expect(pane.getByTestId("ChatBlock.messageRow")).toHaveCount(1);
  const mark = page.getByTestId("Whiteboard.chatMarkButton");
  await expect(mark).toHaveText("1");
  // Not in the board's document: the item's text is unchanged.
  await expect(item(page, "相談したい付箋")).not.toContainText("この案");

  const otherContext = await browser.newContext({ storageState: authFile("admin") });
  try {
    const other = await otherContext.newPage();
    await other.goto(`pages/${id}`);
    await expect(other.getByTestId("Whiteboard.canvas")).toBeVisible();
    const theirMark = other.getByTestId("Whiteboard.chatMarkButton");
    await expect(theirMark).toHaveText("1");
    await theirMark.click();
    const theirPane = other.getByTestId("ReviewPane");
    await expect(theirPane.getByTestId("ChatBlock.text")).toHaveText("この案でよいですか");
    await theirPane.getByTestId("ChatBlock.messageInput").fill("よいと思います");
    await theirPane.getByTestId("ChatBlock.sendButton").click();
    // The first one sees it without reloading.
    await expect(pane.getByTestId("ChatBlock.messageRow")).toHaveCount(2);
    await expect(mark).toHaveText("2");

    // Resolved: the pane closes and the marks go.
    await pane.getByTestId("ReviewPane.resolveButton").click();
    await expect(pane).toHaveCount(0);
    await expect(mark).toHaveCount(0);
    await expect(other.getByTestId("ReviewPane.resolvedStatus")).toBeVisible();
    await other.getByTestId("ReviewPane.closeButton").click();
    await expect(theirMark).toHaveCount(0);
  } finally {
    await otherContext.close();
  }

  // Opened again from the menu ("open"); the item deleted, the thread says so.
  await page.mouse.click(note.x + 20, note.y + 20, { button: "right" });
  await expect(page.getByTestId("Whiteboard.chatMenuItem")).toHaveText("チャットを開く");
  await page.getByTestId("Whiteboard.chatMenuItem").click();
  await expect(pane.getByTestId("ChatBlock.messageRow")).toHaveCount(2);
  await page.mouse.click(note.x + 20, note.y + 20);
  await page.keyboard.press("Delete");
  await expect(item(page, "相談したい付箋")).toHaveCount(0);
  await expect(pane.getByTestId("ReviewPane.blockText")).toHaveText("（このオブジェクトはもうボードにありません）");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
