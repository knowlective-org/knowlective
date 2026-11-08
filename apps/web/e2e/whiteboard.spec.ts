import { type Page, expect, test } from "@playwright/test";
import { ACCOUNTS, HOME_PAGE_ID, authFile } from "./accounts";
import { addPageFromTree, openPage, trashOpenPage } from "./helpers";

// Adds a whiteboard under the E2E home page (the sidebar's "＋" menu),
// titles it, and returns its id.
async function createWhiteboard(page: Page, label: string): Promise<{ id: string; title: string }> {
  await openPage(page, HOME_PAGE_ID);
  await addPageFromTree(page, HOME_PAGE_ID, "whiteboard");
  await page.waitForURL((url) => /\/pages\/(?!e2e-home)[^/]+$/.test(url.pathname));
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
  const title = `${label} ${Date.now()}`;
  await page.getByTestId("TitleField").fill(title);
  return { id: new URL(page.url()).pathname.split("/").pop()!, title };
}

// Clicks the board at (x, y) from its top left corner.
async function clickBoard(page: Page, x: number, y: number, options: { dblclick?: boolean } = {}) {
  const box = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
  if (options.dblclick) await page.mouse.dblclick(box.x + x, box.y + y);
  else await page.mouse.click(box.x + x, box.y + y);
}

// Adds a sticky note at (x, y) with the tool, typed into, and back on the board.
async function addSticky(page: Page, x: number, y: number, text: string) {
  await page.getByTestId("Whiteboard.stickyToolButton").click();
  await clickBoard(page, x, y);
  await page.getByTestId("Whiteboard.textInput").fill(text);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("Whiteboard.textInput")).toHaveCount(0);
}

const item = (page: Page, text: string) => page.getByTestId("Whiteboard.item").filter({ hasText: text });

test.describe("Whiteboard", () => {
  test("sticky notes and connectors show up on the other person's screen as they are made", async ({ browser }) => {
    const editorContext = await browser.newContext({ storageState: authFile("editor") });
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const editor = await editorContext.newPage();
    const admin = await adminContext.newPage();
    try {
      const { id, title } = await createWhiteboard(editor, "E2E ホワイトボード");
      await expect(editor.getByTestId("Whiteboard.emptyStatus")).toBeVisible();
      await expect(editor.getByTestId("PageMenu.button")).toBeVisible();

      await admin.goto(`pages/${id}`);
      await expect(admin.getByTestId("Whiteboard.canvas")).toBeVisible();
      await expect(admin.getByTestId("TitleField")).toHaveValue(title);

      await addSticky(editor, 200, 150, "最初の付箋");
      await expect(item(admin, "最初の付箋")).toBeVisible();

      // Double-clicking the background does nothing.
      await clickBoard(editor, 600, 350, { dblclick: true });
      await expect(editor.getByTestId("Whiteboard.textInput")).toHaveCount(0);
      await expect(editor.getByTestId("Whiteboard.item")).toHaveCount(1);
      await addSticky(editor, 600, 350, "二枚目の付箋");
      await expect(item(admin, "二枚目の付箋")).toBeVisible();

      // A connector, dragged from one note to the other.
      await editor.getByTestId("Whiteboard.connectorToolButton").click();
      const from = (await item(editor, "最初の付箋").boundingBox())!;
      const to = (await item(editor, "二枚目の付箋").boundingBox())!;
      await editor.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await editor.mouse.down();
      await editor.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
      await editor.mouse.up();
      await expect(admin.getByTestId("Whiteboard.connector")).toHaveCount(1);

      // The editor's pointer, with their name.
      await clickBoard(editor, 420, 80);
      await editor.mouse.move(500, 300, { steps: 3 });
      await expect(admin.getByTestId("Whiteboard.cursor").filter({ hasText: ACCOUNTS.editor.name })).toBeVisible();

      // Deleting a note takes its connector with it; undo brings both back.
      await item(editor, "最初の付箋").click();
      await editor.keyboard.press("Delete");
      await expect(item(admin, "最初の付箋")).toHaveCount(0);
      await expect(admin.getByTestId("Whiteboard.connector")).toHaveCount(0);
      await editor.keyboard.press("Control+z");
      await expect(item(admin, "最初の付箋")).toBeVisible();
      await expect(admin.getByTestId("Whiteboard.connector")).toHaveCount(1);

      // Kept: still there after reloading.
      await expect(editor.getByTestId("PageView.status")).toHaveCount(0);
      await editor.reload();
      await expect(item(editor, "最初の付箋")).toBeVisible();
      await expect(item(editor, "二枚目の付箋")).toBeVisible();

      // Nothing to export as Markdown or PDF.
      await editor.getByTestId("PageMenu.button").click();
      await expect(editor.getByTestId("PageMenu.exportMarkdown")).toHaveCount(0);
      await editor.keyboard.press("Escape");

      await trashOpenPage(editor);
    } finally {
      await editorContext.close();
      await adminContext.close();
    }
  });

  test("the text on a whiteboard can be searched for", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      const { id } = await createWhiteboard(page, "E2E ホワイトボードの検索");
      const word = `ボード検索${Date.now()}`;
      await addSticky(page, 200, 150, word);
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      const result = page.locator(`[data-ui="SearchPage.result"][data-id="${id}"]`);
      // Indexed when the collab server stores the document (a moment after the edit).
      await expect
        .poll(
          async () => {
            await page.goto(`search?mode=keyword&q=${encodeURIComponent(word)}`);
            return result.count();
          },
          { timeout: 20_000 },
        )
        .toBe(1);
      await openPageWhiteboard(page, id);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("dragging with the right button moves the view, and a line crossing another hops over it", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの交差");
      // Two lines crossing in an X: top left to bottom right, then top right to bottom left.
      await addSticky(page, 150, 100, "左上");
      await addSticky(page, 650, 400, "右下");
      await addSticky(page, 650, 100, "右上");
      await addSticky(page, 150, 400, "左下");
      const connect = async (from: string, to: string) => {
        await page.getByTestId("Whiteboard.connectorToolButton").click();
        const a = (await item(page, from).boundingBox())!;
        const b = (await item(page, to).boundingBox())!;
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
      };
      await connect("左上", "右下");
      await connect("右上", "左下");
      const lines = page.getByTestId("Whiteboard.connector");
      await expect(lines).toHaveCount(2);
      // The one made later is on top: only it has the hop (an arc).
      const paths = await lines.evaluateAll((gs) => gs.map((g) => g.querySelectorAll("path")[1].getAttribute("d") ?? ""));
      expect(paths[0]).not.toContain(" A ");
      expect(paths[1]).toContain(" A ");

      // Arrowheads: at the end at first; at both ends, or none, when chosen.
      const first = lines.first();
      const markers = () =>
        first.evaluate((g) => {
          const line = g.querySelectorAll("path")[1];
          return [!!line.getAttribute("marker-start"), !!line.getAttribute("marker-end")];
        });
      expect(await markers()).toEqual([false, true]);
      await first.locator("path").first().click({ force: true });
      await page.locator('[data-ui="Whiteboard.arrowsButton"][data-id="both"]').click();
      await expect(first).toHaveAttribute("data-arrows", "both");
      expect(await markers()).toEqual([true, true]);
      await page.locator('[data-ui="Whiteboard.arrowsButton"][data-id="none"]').click();
      await expect(first).toHaveAttribute("data-arrows", "none");
      expect(await markers()).toEqual([false, false]);

      // Zoomed with the wheel to an odd value: the zoom shown goes back to 100%.
      const zoom = page.getByTestId("Whiteboard.zoomResetButton");
      await page.getByTestId("Whiteboard.canvas").hover();
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 7);
      await page.keyboard.up("Control");
      await expect(zoom).not.toHaveText("100%");
      await zoom.click();
      await expect(zoom).toHaveText("100%");
      await page.getByTestId("Whiteboard.zoomInButton").click();
      await expect(zoom).toHaveText("125%");
      await page.getByTestId("Whiteboard.zoomOutButton").click();
      await expect(zoom).toHaveText("100%");

      // A right-button drag on an item moves the view, not the item, and
      // doesn't select it. (The connector just made is selected: clear that.)
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("Whiteboard.selectionBar")).toHaveCount(0);
      const before = (await item(page, "左上").boundingBox())!;
      await page.mouse.move(before.x + 20, before.y + 20);
      await page.mouse.down({ button: "right" });
      await page.mouse.move(before.x + 120, before.y + 80, { steps: 5 });
      await page.mouse.up({ button: "right" });
      const after = (await item(page, "左上").boundingBox())!;
      expect(Math.round(after.x - before.x)).toBe(100);
      expect(Math.round(after.y - before.y)).toBe(60);
      await expect(page.getByTestId("Whiteboard.selectionBar")).toHaveCount(0);

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("dragging with Alt held moves a copy and leaves the original", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの複製");
      await addSticky(page, 200, 150, "複製する付箋");
      const notes = item(page, "複製する付箋");
      const start = (await notes.first().boundingBox())!;

      // Alt + click alone leaves no copy behind.
      await page.keyboard.down("Alt");
      await page.mouse.click(start.x + 20, start.y + 20);
      await page.keyboard.up("Alt");
      await expect(notes).toHaveCount(1);

      await page.keyboard.down("Alt");
      await page.mouse.move(start.x + 20, start.y + 20);
      await page.mouse.down();
      await page.mouse.move(start.x + 320, start.y + 120, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await expect(notes).toHaveCount(2);
      const boxes = (await notes.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))).map((r) => [Math.round(r.x), Math.round(r.y)]);
      expect(boxes).toContainEqual([Math.round(start.x), Math.round(start.y)]);
      expect(boxes).toContainEqual([Math.round(start.x) + 300, Math.round(start.y) + 100]);

      // One undo takes the copy back.
      await page.keyboard.press("Control+z");
      await expect(notes).toHaveCount(1);
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("rectangles and ellipses are drawn by dragging, square and round with Shift", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの図形");
      const canvas = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      const drag = async (tool: string, from: [number, number], to: [number, number], shift = false) => {
        await page.getByTestId(`Whiteboard.${tool}ToolButton`).click();
        await page.mouse.move(canvas.x + from[0], canvas.y + from[1]);
        await page.mouse.down();
        if (shift) await page.keyboard.down("Shift");
        await page.mouse.move(canvas.x + to[0], canvas.y + to[1], { steps: 6 });
        await page.mouse.up();
        if (shift) await page.keyboard.up("Shift");
        // Its text field opens, as for a click.
        await expect(page.getByTestId("Whiteboard.textInput")).toBeFocused();
        await page.keyboard.press("Escape");
      };
      const sizeOf = async (type: string) => {
        const box = (await page.locator(`[data-ui="Whiteboard.item"][data-type="${type}"]`).boundingBox())!;
        return [Math.round(box.width), Math.round(box.height)];
      };

      // Dragged up and to the left works too.
      await drag("rect", [400, 260], [100, 100]);
      expect(await sizeOf("rect")).toEqual([300, 160]);
      await drag("ellipse", [500, 100], [650, 350], true);
      expect(await sizeOf("ellipse")).toEqual([250, 250]);

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("double-clicking an item already on the board edits its text, with no new item made", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの文字の編集");
      await page.getByTestId("Whiteboard.rectToolButton").click();
      await clickBoard(page, 300, 200);
      await page.keyboard.press("Escape");
      const rect = page.locator('[data-ui="Whiteboard.item"][data-type="rect"]');
      await expect(rect).toHaveCount(1);

      await rect.dblclick();
      await expect(page.getByTestId("Whiteboard.textInput")).toBeFocused();
      await page.keyboard.type("あとから入れた文字");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("Whiteboard.item")).toHaveCount(1);
      await expect(rect).toHaveText("あとから入れた文字");

      // Enter on the selected item edits it too.
      await rect.click();
      await page.keyboard.press("Enter");
      await page.keyboard.type("（追記）");
      await page.keyboard.press("Escape");
      await expect(rect).toHaveText("あとから入れた文字（追記）");

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("connectors: drawn from a box's dots, and their ends moved to other boxes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードのつなぎ替え");
      await addSticky(page, 150, 150, "始まり");
      await addSticky(page, 450, 150, "終わり");
      await addSticky(page, 450, 400, "付け替え先");
      // At 100%, a new sticky note is 100 × 100.
      const size = (await item(page, "始まり").boundingBox())!;
      expect([Math.round(size.width), Math.round(size.height)]).toEqual([100, 100]);

      // Over a box: dots on its sides; one dragged to another box connects them.
      await item(page, "始まり").hover();
      const dot = page.locator('[data-ui="Whiteboard.connectHandle"][data-id="right"]');
      await expect(page.getByTestId("Whiteboard.connectHandle")).toHaveCount(4);
      const d = (await dot.boundingBox())!;
      const target = (await item(page, "終わり").boundingBox())!;
      await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 50, target.y + 50, { steps: 6 });
      await page.mouse.up();
      const line = page.getByTestId("Whiteboard.connector");
      await expect(line).toHaveCount(1);
      const idOf = async (text: string) => (await item(page, text).getAttribute("data-id"))!;
      await expect(line).toHaveAttribute("data-to", await idOf("終わり"));
      // Drawn dashed instead.
      await page.locator('[data-ui="Whiteboard.strokeButton"][data-id="dashed"]').click();
      await expect(line).toHaveAttribute("data-stroke", "dashed");

      // The same way again: no second connector on top of the first.
      await page.keyboard.press("Escape");
      await item(page, "始まり").hover();
      const d2 = (await dot.boundingBox())!;
      await page.mouse.move(d2.x + d2.width / 2, d2.y + d2.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 50, target.y + 50, { steps: 6 });
      await page.mouse.up();
      await expect(line).toHaveCount(1);
      await expect(page.getByTestId("Notice")).toHaveText("すでに同じオブジェクト同士を接続しているコネクターが存在しています");
      // Nor the other way round.
      await page.keyboard.press("Escape");
      await item(page, "終わり").hover();
      const back = page.locator('[data-ui="Whiteboard.connectHandle"][data-id="left"]');
      const d3 = (await back.boundingBox())!;
      const source = (await item(page, "始まり").boundingBox())!;
      await page.mouse.move(d3.x + d3.width / 2, d3.y + d3.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + 50, source.y + 50, { steps: 6 });
      await page.mouse.up();
      await expect(line).toHaveCount(1);
      await expect(line).toHaveAttribute("data-from", await idOf("始まり"));

      // The new connector is selected: its end, dragged to another box, goes there.
      const end = page.locator('[data-ui="Whiteboard.connectorEndHandle"][data-id="to"]');
      const e = (await end.boundingBox())!;
      const other = (await item(page, "付け替え先").boundingBox())!;
      await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
      await page.mouse.down();
      await page.mouse.move(other.x + 50, other.y + 50, { steps: 6 });
      await page.mouse.up();
      await expect(line).toHaveAttribute("data-to", await idOf("付け替え先"));
      await expect(line).toHaveAttribute("data-from", await idOf("始まり"));

      // Dropped on the background: it stays where it was.
      const e2 = (await end.boundingBox())!;
      await page.mouse.move(e2.x + e2.width / 2, e2.y + e2.height / 2);
      await page.mouse.down();
      await page.mouse.move(e2.x + 150, e2.y - 200, { steps: 6 });
      await page.mouse.up();
      await expect(line).toHaveAttribute("data-to", await idOf("付け替え先"));

      // Dropped on the empty board: a new box of the same kind and size there,
      // connected, its text being edited.
      await page.keyboard.press("Escape");
      await item(page, "付け替え先").hover();
      const down = page.locator('[data-ui="Whiteboard.connectHandle"][data-id="right"]');
      const d4 = (await down.boundingBox())!;
      const canvas = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      await page.mouse.move(d4.x + d4.width / 2, d4.y + d4.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 750, canvas.y + 450, { steps: 6 });
      await page.mouse.up();
      await expect(page.getByTestId("Whiteboard.item")).toHaveCount(4);
      await expect(line).toHaveCount(2);
      await page.getByTestId("Whiteboard.textInput").fill("新しい付箋");
      await page.keyboard.press("Escape");
      const copy = (await item(page, "新しい付箋").boundingBox())!;
      expect([Math.round(copy.width), Math.round(copy.height)]).toEqual([100, 100]);
      expect(Math.round(copy.x + copy.width / 2)).toBe(Math.round(canvas.x + 750));
      await expect(line.nth(1)).toHaveAttribute("data-from", await idOf("付け替え先"));
      await expect(line.nth(1)).toHaveAttribute("data-to", await idOf("新しい付箋"));

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("Alt held when a drag ends copies, whenever it was pressed; let go before, it doesn't", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの Alt");
      await addSticky(page, 200, 150, "Alt の付箋");
      const notes = item(page, "Alt の付箋");
      const start = (await notes.boundingBox())!;
      const positions = async () =>
        (await notes.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))).map((r) => [Math.round(r.x), Math.round(r.y)]);

      // Alt pressed during the drag: a copy at the drop, the original where it was.
      await page.mouse.move(start.x + 20, start.y + 20);
      await page.mouse.down();
      await page.mouse.move(start.x + 220, start.y + 20, { steps: 6 });
      // While dragging: an outline where it started; no "+" until Alt is held.
      await expect(page.getByTestId("Whiteboard.dragOrigin")).toHaveCount(1);
      await expect(page.getByTestId("Whiteboard.copyMark")).toHaveCount(0);
      await page.keyboard.down("Alt");
      await expect(page.getByTestId("Whiteboard.copyMark")).toHaveCount(1);
      await page.mouse.move(start.x + 320, start.y + 20, { steps: 2 });
      await page.mouse.up();
      await expect(page.getByTestId("Whiteboard.dragOrigin")).toHaveCount(0);
      await expect(page.getByTestId("Whiteboard.copyMark")).toHaveCount(0);
      await page.keyboard.up("Alt");
      await expect(notes).toHaveCount(2);
      expect(await positions()).toContainEqual([Math.round(start.x), Math.round(start.y)]);
      expect(await positions()).toContainEqual([Math.round(start.x) + 300, Math.round(start.y)]);

      // Alt held at the start but let go before the end: just a move.
      await page.keyboard.down("Alt");
      await page.mouse.move(start.x + 20, start.y + 20);
      await page.mouse.down();
      await page.mouse.move(start.x + 20, start.y + 220, { steps: 6 });
      await page.keyboard.up("Alt");
      await page.mouse.move(start.x + 20, start.y + 250, { steps: 2 });
      await page.mouse.up();
      await expect(notes).toHaveCount(2);
      expect(await positions()).toContainEqual([Math.round(start.x), Math.round(start.y) + 230]);
      expect(await positions()).not.toContainEqual([Math.round(start.x), Math.round(start.y)]);

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("plain lines are drawn, moved and reshaped; connectors can turn at right angles", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの直線");
      const canvas = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      const at = (x: number, y: number) => [canvas.x + x, canvas.y + y] as const;
      const ends = async () => {
        const d = (await page.getByTestId("Whiteboard.line").locator("path").first().getAttribute("d"))!;
        return d.match(/-?[\d.]+/g)!.map(Number);
      };

      // Drawn with Shift: level, though the pointer ends a little lower.
      await page.getByTestId("Whiteboard.lineToolButton").click();
      await page.mouse.move(...at(100, 300));
      await page.mouse.down();
      await page.keyboard.down("Shift");
      await page.mouse.move(...at(400, 315), { steps: 6 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await expect(page.getByTestId("Whiteboard.line")).toHaveCount(1);
      await expect(page.getByTestId("Whiteboard.line")).toHaveAttribute("data-arrows", "none");
      const [x1, y1, x2, y2] = await ends();
      expect(y2).toBe(y1);
      expect(x2 - x1).toBeGreaterThan(290);

      // Its stroke, from the selection bar: thick, dashed, double (a second,
      // board-colored line down its middle), and back to normal.
      const line = page.getByTestId("Whiteboard.line");
      const stroke = (name: string) => page.locator(`[data-ui="Whiteboard.strokeButton"][data-id="${name}"]`);
      await expect(line).toHaveAttribute("data-stroke", "solid");
      await stroke("bold").click();
      await expect(line).toHaveAttribute("data-stroke", "bold");
      await expect(stroke("bold")).toHaveAttribute("aria-pressed", "true");
      await stroke("dashed").click();
      await expect(line).toHaveAttribute("data-stroke", "dashed");
      await stroke("double").click();
      await expect(line).toHaveAttribute("data-stroke", "double");
      await expect(line.locator("path")).toHaveCount(4);
      await stroke("solid").click();
      await expect(line.locator("path")).toHaveCount(2);

      // Selected after drawing: one end dragged elsewhere.
      const handle = page.locator('[data-ui="Whiteboard.lineEndHandle"][data-id="2"]');
      const h = (await handle.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 100, { steps: 6 });
      await page.mouse.up();
      const [, , , y2b] = await ends();
      expect(Math.round(y2b - y1)).toBe(100);

      // Dragged by the line itself: both ends move.
      const before = await ends();
      const centerOf = async (end: string) => {
        const b = (await page.locator(`[data-ui="Whiteboard.lineEndHandle"][data-id="${end}"]`).boundingBox())!;
        return [b.x + b.width / 2, b.y + b.height / 2];
      };
      const [ax, ay] = await centerOf("1");
      const [bx, by] = await centerOf("2");
      await page.mouse.move((ax + bx) / 2, (ay + by) / 2);
      await page.mouse.down();
      await page.mouse.move((ax + bx) / 2, (ay + by) / 2 + 60, { steps: 6 });
      await page.mouse.up();
      const after = await ends();
      expect(after.map((v, i) => Math.round(v - before[i]))).toEqual([0, 60, 0, 60]);
      // Its arrowheads can be chosen too.
      await page.locator('[data-ui="Whiteboard.arrowsButton"][data-id="end"]').click();
      await expect(page.getByTestId("Whiteboard.line")).toHaveAttribute("data-arrows", "end");
      // Double-clicked (it slopes 100 down over about 300 across): made level, as long.
      const [cx1, cy1] = await centerOf("1");
      const [cx2, cy2] = await centerOf("2");
      const slope = await ends();
      await page.mouse.dblclick((cx1 + cx2) / 2, (cy1 + cy2) / 2);
      await expect.poll(async () => { const [, a, , b] = await ends(); return a === b; }).toBe(true);
      const level = await ends();
      const length = (v: number[]) => Math.hypot(v[2] - v[0], v[3] - v[1]);
      expect(Math.abs(length(level) - length(slope))).toBeLessThan(2);

      // A connector between two notes not in line, made to turn at right angles.
      await page.keyboard.press("Escape");
      await addSticky(page, 150, 120, "曲がる元");
      await addSticky(page, 550, 220, "曲がる先");
      await item(page, "曲がる元").hover();
      const dot = page.locator('[data-ui="Whiteboard.connectHandle"][data-id="right"]');
      const d = (await dot.boundingBox())!;
      const target = (await item(page, "曲がる先").boundingBox())!;
      await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 50, target.y + 50, { steps: 6 });
      await page.mouse.up();
      const connector = page.getByTestId("Whiteboard.connector");
      await expect(connector).toHaveAttribute("data-route", "straight");
      await page.locator('[data-ui="Whiteboard.routeButton"][data-id="elbow"]').click();
      await expect(connector).toHaveAttribute("data-route", "elbow");
      // Rounded corners: curves in its path.
      const path = () => connector.locator("path").nth(1).getAttribute("d");
      const elbow = await path();
      expect(elbow).toContain(" Q ");
      // Its end dropped by the left side of the note it goes to (it came in
      // from above): it comes in from the left.
      const end = page.locator('[data-ui="Whiteboard.connectorEndHandle"][data-id="to"]');
      const e = (await end.boundingBox())!;
      const goal = (await item(page, "曲がる先").boundingBox())!;
      await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
      await page.mouse.down();
      await page.mouse.move(goal.x + 8, goal.y + goal.height / 2, { steps: 6 });
      // While dragging, the side it would go to is marked.
      await expect(page.locator('[data-ui="Whiteboard.connectHandle"][data-id="left"]')).toBeVisible();
      await page.mouse.up();
      await expect(connector).toHaveAttribute("data-to-side", "left");
      expect(await path()).not.toBe(elbow);
      expect(await path()).toContain(" Q ");
      // Dropped in its middle: routed by itself again.
      const e2 = (await end.boundingBox())!;
      await page.mouse.move(e2.x + e2.width / 2, e2.y + e2.height / 2);
      await page.mouse.down();
      await page.mouse.move(goal.x + goal.width / 2, goal.y + goal.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect(connector).not.toHaveAttribute("data-to-side");
      expect(await path()).toBe(elbow);

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("shapes can be changed, text can hold lists, connectors take text by their ends, and the board goes full screen", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの文字");
      await addSticky(page, 150, 150, "買うもの");
      const note = item(page, "買うもの");

      // A sticky note made a rectangle, then an ellipse.
      await note.click();
      await page.locator('[data-ui="Whiteboard.shapeButton"][data-id="rect"]').click();
      await expect(note).toHaveAttribute("data-type", "rect");
      await page.locator('[data-ui="Whiteboard.shapeButton"][data-id="ellipse"]').click();
      await expect(note).toHaveAttribute("data-type", "ellipse");

      // Typing a list: Enter goes on with it, and an empty item ends it.
      await note.dblclick();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("- 牛乳");
      await page.keyboard.press("Enter");
      await page.keyboard.type("卵");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("以上");
      await expect(page.getByTestId("Whiteboard.textInput")).toHaveValue("買うもの\n- 牛乳\n- 卵\n以上");
      await page.keyboard.press("Escape");
      await expect(note.locator("ul li")).toHaveText(["牛乳", "卵"]);

      // The whole text made a numbered list with the button.
      await page.getByTestId("Whiteboard.numberedListButton").click();
      await expect(note.locator("ol li")).toHaveText(["買うもの", "牛乳", "卵", "以上"]);

      // A connector, with text by its start and end, and halfway along.
      await addSticky(page, 600, 150, "店");
      await item(page, "店").hover();
      const dot = page.locator('[data-ui="Whiteboard.connectHandle"][data-id="left"]');
      const d = (await dot.boundingBox())!;
      const back = (await note.boundingBox())!;
      await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
      await page.mouse.down();
      await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2, { steps: 6 });
      await page.mouse.up();
      const connector = page.getByTestId("Whiteboard.connector");
      await expect(connector).toHaveCount(1);
      const line = (await connector.locator("path").first().boundingBox())!;
      const along = (f: number) => [line.x + line.width * (1 - f), line.y + line.height / 2] as const;
      const label = (field: string) => page.locator(`[data-ui="Whiteboard.connectorLabel"][data-id="${field}"]`);
      // Drawn from the right ("店") to the left: its start is on the right.
      await page.mouse.dblclick(...along(0.1));
      await page.keyboard.type("1");
      await page.keyboard.press("Escape");
      await page.mouse.dblclick(...along(0.9));
      await page.keyboard.type("n");
      await page.keyboard.press("Escape");
      await page.mouse.dblclick(...along(0.5));
      await page.keyboard.type("仕入れ");
      await page.keyboard.press("Escape");
      await expect(label("startText")).toHaveText("1");
      await expect(label("endText")).toHaveText("n");
      await expect(label("text")).toHaveText("仕入れ");
      // The start's text is by the start (the right).
      expect((await label("startText").boundingBox())!.x).toBeGreaterThan((await label("endText").boundingBox())!.x);
      // On one line, across: not a character to a line, running down.
      const middle = (await label("text").boundingBox())!;
      expect(middle.width).toBeGreaterThan(middle.height);

      // Full screen: the board over the whole window, the sidebar hidden
      // under it; Esc (with nothing selected) brings it back. (Next.js's dev
      // indicator, at the window's bottom right, would cover the button there.)
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.getByTestId("Whiteboard.fullscreenButton").click();
      const viewport = page.viewportSize()!;
      const board = page.getByTestId("Whiteboard");
      await expect(board).toHaveAttribute("data-fullscreen", "true");
      expect(await board.boundingBox()).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
      await page.mouse.click(viewport.width / 2, viewport.height - 40);
      await page.keyboard.press("Escape");
      await expect(board).not.toHaveAttribute("data-fullscreen");
      await page.getByTestId("Whiteboard.fullscreenButton").click();
      await expect(board).toHaveAttribute("data-fullscreen", "true");
      await page.getByTestId("Whiteboard.fullscreenButton").click();
      await expect(board).not.toHaveAttribute("data-fullscreen");

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("diamonds; text moved anywhere, and running out below a shape too small for it", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードのひし形");
      // Drawn by dragging with the diamond tool.
      await page.getByTestId("Whiteboard.diamondToolButton").click();
      await page.mouse.move(...(await (async () => {
        const c = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
        return [c.x + 150, c.y + 100] as const;
      })()));
      await page.mouse.down();
      const c = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      await page.mouse.move(c.x + 330, c.y + 220, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.type("分岐");
      await page.keyboard.press("Escape");
      const diamond = page.locator('[data-ui="Whiteboard.item"][data-type="diamond"]');
      await expect(diamond).toHaveText("分岐");
      await expect(diamond.locator("polygon")).toHaveCount(1);
      const size = (await diamond.boundingBox())!;
      expect([Math.round(size.width), Math.round(size.height)]).toEqual([180, 120]);

      // Much more text than fits: it runs out below, not cut off.
      await diamond.dblclick();
      await page.keyboard.press("Control+End");
      for (let i = 1; i <= 8; i++) {
        await page.keyboard.press("Enter");
        await page.keyboard.type(`行${i}`);
      }
      await page.keyboard.press("Escape");
      await expect(diamond).toContainText("行8");
      const shape = (await diamond.boundingBox())!;
      // The text (one block): its bottom below the shape's, its top inside it.
      const block = (await diamond.getByText("行8").boundingBox())!;
      expect(block.y + block.height).toBeGreaterThan(shape.y + shape.height);
      const firstLine = (await diamond.getByText("分岐").boundingBox())!;
      expect(firstLine.y).toBeGreaterThanOrEqual(shape.y);

      // Moved by its handle, outside the shape; then back in place.
      const handle = page.getByTestId("Whiteboard.moveTextHandle");
      const h = (await handle.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + 250, h.y + h.height / 2 - 30, { steps: 6 });
      await page.mouse.up();
      const moved = (await diamond.getByText("分岐").boundingBox())!;
      expect(Math.round(moved.x - firstLine.x)).toBe(250);
      expect(Math.round(moved.y - firstLine.y)).toBe(-30);
      expect(moved.x).toBeGreaterThan(shape.x + shape.width);
      await page.getByTestId("Whiteboard.resetTextButton").click();
      await expect.poll(async () => Math.round((await diamond.getByText("分岐").boundingBox())!.x)).toBe(Math.round(firstLine.x));
      await expect(page.getByTestId("Whiteboard.resetTextButton")).toHaveCount(0);

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("a saved version of the board is shown in the page history", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      const { id } = await createWhiteboard(page, "E2E ホワイトボードの履歴");
      await addSticky(page, 200, 150, "履歴に残る付箋");
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      // Leaving the page closes the document, which saves a version.
      await openPage(page, HOME_PAGE_ID);
      const preview = page.getByTestId("VersionPreview");
      await expect
        .poll(
          async () => {
            await page.goto(`pages/${id}/history`);
            // The newest version loads after the screen (none yet: no board).
            await preview.getByTestId("Whiteboard.canvas").waitFor({ timeout: 5_000 }).catch(() => {});
            return item(page, "履歴に残る付箋").count();
          },
          { timeout: 20_000 },
        )
        .toBe(1);
      // Read-only there.
      await expect(preview.getByTestId("Whiteboard.toolbar")).toHaveCount(0);

      await openPageWhiteboard(page, id);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("someone with view access can look around the board but not change it", async ({ browser }) => {
    const editorContext = await browser.newContext({ storageState: authFile("editor") });
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const editor = await editorContext.newPage();
    const viewer = await viewerContext.newPage();
    try {
      const { id } = await createWhiteboard(editor, "E2E ホワイトボードの閲覧");
      await addSticky(editor, 200, 150, "閲覧者にも見える付箋");

      await openPageWhiteboard(viewer, id);
      await expect(item(viewer, "閲覧者にも見える付箋")).toBeVisible();
      await expect(viewer.getByTestId("PageView.readOnlyBadge")).toBeVisible();
      await expect(viewer.getByTestId("Whiteboard.toolbar")).toHaveCount(0);
      // Double-clicking adds nothing, and selecting shows no actions.
      await clickBoard(viewer, 600, 350, { dblclick: true });
      await expect(viewer.getByTestId("Whiteboard.textInput")).toHaveCount(0);
      await item(viewer, "閲覧者にも見える付箋").click();
      await expect(viewer.getByTestId("Whiteboard.selectionBar")).toHaveCount(0);
      // Zooming works.
      await viewer.getByTestId("Whiteboard.zoomInButton").click();
      await expect(viewer.getByTestId("Whiteboard.zoomResetButton")).not.toHaveText("100%");

      await trashOpenPage(editor);
    } finally {
      await editorContext.close();
      await viewerContext.close();
    }
  });
});

async function openPageWhiteboard(page: Page, id: string) {
  await page.goto(`pages/${id}`);
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
}
