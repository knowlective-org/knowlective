import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { addPageFromTree, openPage, trashOpenPage } from "./helpers";

// Grouping, resizing several items together, and the board's menu (right
// button), on a whiteboard (slides use the same board).

async function createWhiteboard(page: Page, label: string) {
  await openPage(page, HOME_PAGE_ID);
  await addPageFromTree(page, HOME_PAGE_ID, "whiteboard");
  await page.waitForURL((url) => /\/pages\/(?!e2e-home)[^/]+$/.test(url.pathname));
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
  await page.getByTestId("TitleField").fill(`${label} ${Date.now()}`);
}

async function boardPoint(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
  return { x: box.x + x, y: box.y + y };
}

async function addSticky(page: Page, x: number, y: number, text: string) {
  await page.getByTestId("Whiteboard.stickyToolButton").click();
  const at = await boardPoint(page, x, y);
  await page.mouse.click(at.x, at.y);
  await page.getByTestId("Whiteboard.textInput").fill(text);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("Whiteboard.textInput")).toHaveCount(0);
}

// Drags a selection rectangle over the board between two points.
async function marquee(page: Page, from: [number, number], to: [number, number]) {
  const a = await boardPoint(page, ...from);
  const b = await boardPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

const item = (page: Page, text: string) => page.getByTestId("Whiteboard.item").filter({ hasText: text });
const selected = (page: Page) => page.locator('[data-ui="Whiteboard.item"][data-selected]');

test.use({ storageState: authFile("editor") });

test("items grouped are picked, moved and resized together; a click picks one inside; ungrouped again from the menu", async ({ page }) => {
  await createWhiteboard(page, "E2E ホワイトボードのグループ");
  await addSticky(page, 150, 150, "グループA");
  await addSticky(page, 350, 150, "グループB");
  await addSticky(page, 150, 380, "外の付箋");

  // Both picked, then grouped (Ctrl+G).
  await marquee(page, [50, 60], [460, 260]);
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press("Control+g");
  await expect(page.getByTestId("Whiteboard.groupFrame")).toHaveCount(1);
  await expect(page.getByTestId("Whiteboard.ungroupButton")).toBeVisible();

  // A click on the board, then on one of them: the whole group.
  const empty = await boardPoint(page, 700, 450);
  await page.mouse.click(empty.x, empty.y);
  await expect(selected(page)).toHaveCount(0);
  const a = (await item(page, "グループA").boundingBox())!;
  await page.mouse.click(a.x + 20, a.y + 20);
  await expect(selected(page)).toHaveCount(2);
  // Clicked again: that one alone, the group still outlined.
  await page.mouse.click(a.x + 20, a.y + 20);
  await expect(selected(page)).toHaveCount(1);
  await expect(item(page, "グループA")).toHaveAttribute("data-selected", "");
  await expect(page.getByTestId("Whiteboard.groupFrame")).toHaveCount(1);

  // Dragged from the board: picked whole again, and both move.
  await page.mouse.click(empty.x, empty.y);
  const b = (await item(page, "グループB").boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y + 70, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await item(page, "グループA").boundingBox())!.x - a.x)).toBe(100);
  await expect.poll(async () => Math.round((await item(page, "グループB").boundingBox())!.y - b.y)).toBe(50);

  // Resized together from the selection's corner: twice the size, each in
  // proportion (the gap between them too).
  const before = { a: (await item(page, "グループA").boundingBox())!, b: (await item(page, "グループB").boundingBox())! };
  const handle = (await page.getByTestId("Whiteboard.scaleHandle").boundingBox())!;
  const frame = (await page.getByTestId("Whiteboard.selectionFrame").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + frame.width, handle.y + handle.height / 2 + frame.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = { a: (await item(page, "グループA").boundingBox())!, b: (await item(page, "グループB").boundingBox())! };
  expect(after.a.width / before.a.width).toBeCloseTo(2, 1);
  expect(after.a.height / before.a.height).toBeCloseTo(2, 1);
  expect(after.a.x).toBeCloseTo(before.a.x, 0);
  expect((after.b.x - after.a.x) / (before.b.x - before.a.x)).toBeCloseTo(2, 1);
  // One undo takes the resize back.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => Math.round((await item(page, "グループA").boundingBox())!.width)).toBe(Math.round(before.a.width));

  // Ungrouped from the menu (the right button on one of them).
  const now = (await item(page, "グループA").boundingBox())!;
  await page.mouse.click(now.x + 20, now.y + 20, { button: "right" });
  await expect(page.getByTestId("Whiteboard.contextMenu")).toBeVisible();
  await expect(page.getByTestId("Whiteboard.groupMenuItem")).toBeDisabled();
  await page.getByTestId("Whiteboard.ungroupMenuItem").click();
  await expect(page.getByTestId("Whiteboard.contextMenu")).toHaveCount(0);
  await expect(page.getByTestId("Whiteboard.groupFrame")).toHaveCount(0);
  await page.mouse.click(empty.x, empty.y);
  await page.mouse.click(now.x + 20, now.y + 20);
  await expect(selected(page)).toHaveCount(1);

  // Kept after reloading: grouped again, the group is there after a reload.
  await marquee(page, [150, 100], [560, 300]);
  await expect(selected(page)).toHaveCount(2);
  await page.getByTestId("Whiteboard.groupButton").click();
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(item(page, "グループA")).toBeVisible();
  const reloaded = (await item(page, "グループA").boundingBox())!;
  await page.mouse.click(reloaded.x + 20, reloaded.y + 20);
  await expect(selected(page)).toHaveCount(2);
  await trashOpenPage(page);
});

test("the board's menu: opened with the right button (not when dragging), it copies, pastes, duplicates and deletes", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createWhiteboard(page, "E2E ホワイトボードのメニュー");
  await addSticky(page, 200, 200, "メニューの付箋");
  const note = item(page, "メニューの付箋");

  // Dragged with the right button: the view moves, no menu.
  const start = (await note.boundingBox())!;
  const p = await boardPoint(page, 600, 400);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(p.x + 80, p.y + 40, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(page.getByTestId("Whiteboard.contextMenu")).toHaveCount(0);
  await expect.poll(async () => Math.round((await note.boundingBox())!.x - start.x)).toBe(80);

  // On the item: it's picked, and the menu is for it. Esc closes it.
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
  await expect(page.getByTestId("Whiteboard.contextMenu")).toBeVisible();
  await expect(note).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("Whiteboard.contextMenu")).toHaveCount(0);

  // Duplicated from the menu.
  await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
  await page.getByTestId("Whiteboard.duplicateMenuItem").click();
  await expect(note).toHaveCount(2);

  // Copied, then pasted on the empty board where the menu opened.
  await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
  await page.getByTestId("Whiteboard.copyMenuItem").click();
  const there = await boardPoint(page, 650, 150);
  await page.mouse.click(there.x, there.y, { button: "right" });
  await expect(page.getByTestId("Whiteboard.copyMenuItem")).toBeDisabled();
  await page.getByTestId("Whiteboard.pasteMenuItem").click();
  await expect(note).toHaveCount(3);
  const pasted = (await note.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))).map((r) => Math.hypot(r.x + r.width / 2 - there.x, r.y + r.height / 2 - there.y));
  expect(Math.min(...pasted)).toBeLessThan(5);

  // Deleted from the menu.
  const last = (await note.last().boundingBox())!;
  await page.mouse.click(last.x + 20, last.y + 20, { button: "right" });
  await page.getByTestId("Whiteboard.deleteMenuItem").click();
  await expect(note).toHaveCount(2);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
