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

  test("copy, cut and paste: the board's own items, what Miro copies, and text", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    // A clipboard event on the board, as the browser sends for Ctrl+C / X / V
    // (the system clipboard isn't used): what it put there, or what's pasted.
    const clipboard = (type: "copy" | "cut" | "paste", data: Record<string, string> = {}) =>
      page.evaluate(
        ({ type, data }) => {
          const transfer = new DataTransfer();
          for (const [format, value] of Object.entries(data)) transfer.setData(format, value);
          const board = document.querySelector('[data-ui="Whiteboard.canvas"]')!;
          board.dispatchEvent(new ClipboardEvent(type, { clipboardData: transfer, bubbles: true, cancelable: true }));
          return { html: transfer.getData("text/html"), text: transfer.getData("text/plain") };
        },
        { type, data },
      );
    try {
      await createWhiteboard(page, "E2E ホワイトボードのコピー");
      await addSticky(page, 150, 150, "コピー元A");
      await addSticky(page, 400, 150, "コピー元B");
      await page.getByTestId("Whiteboard.connectorToolButton").click();
      const a = (await item(page, "コピー元A").boundingBox())!;
      const b = (await item(page, "コピー元B").boundingBox())!;
      await page.mouse.move(a.x + 50, a.y + 50);
      await page.mouse.down();
      await page.mouse.move(b.x + 50, b.y + 50, { steps: 5 });
      await page.mouse.up();
      await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(1);

      await clickBoard(page, 700, 450);
      await page.keyboard.press("Control+a");
      const copied = await clipboard("copy");
      expect(copied.text).toBe("コピー元A\nコピー元B");

      // Pasted under the pointer, with the connector between them; one undo
      // takes it all back.
      const canvas = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      await page.mouse.move(canvas.x + 400, canvas.y + 400);
      await clipboard("paste", { "text/html": copied.html, "text/plain": copied.text });
      await expect(item(page, "コピー元A")).toHaveCount(2);
      await expect(item(page, "コピー元B")).toHaveCount(2);
      await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(2);
      const pasted = (await item(page, "コピー元A").nth(1).boundingBox())!;
      const pastedB = (await item(page, "コピー元B").nth(1).boundingBox())!;
      expect(Math.round((pasted.x + pastedB.x + pastedB.width) / 2)).toBe(Math.round(canvas.x + 400));
      await page.keyboard.press("Control+z");
      await expect(page.getByTestId("Whiteboard.item")).toHaveCount(2);
      await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(1);

      // Cut: gone, with its connector; pasted back.
      await item(page, "コピー元B").click();
      const cut = await clipboard("cut");
      await expect(item(page, "コピー元B")).toHaveCount(0);
      await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(0);
      await clipboard("paste", { "text/html": cut.html });
      await expect(item(page, "コピー元B")).toHaveCount(1);

      // From Miro (its undocumented format: JSON with 59 added to each byte,
      // in Base64): a green sticky note and a diamond, connected.
      const miro = {
        data: {
          objects: [
            { type: 14, id: 0, widgetData: { type: "sticker", json: { _position: { offsetPx: { x: 0, y: 0 }, schema: "canvasOffsetPx" }, scale: { scale: 0.5 }, size: { width: 200, height: 200 }, text: "<p>Miroの付箋</p>", style: JSON.stringify({ sbc: 0x6ae08d }) } } },
            { type: 14, id: 1, widgetData: { type: "shape", json: { _position: { offsetPx: { x: 300, y: 0 }, schema: "canvasOffsetPx" }, scale: { scale: 1 }, size: { width: 160, height: 100 }, text: "<p>Miroの図形</p>", shape: "8", style: JSON.stringify({ bc: -1 }) } } },
            { type: 14, id: 2, widgetData: { type: "line", json: { primary: { point: { x: 1, y: 0.5 }, widgetIndex: 0 }, secondary: { point: { x: 0, y: 0.5 }, widgetIndex: 1 }, style: JSON.stringify({ a_end: 9, lt: 0 }), line: { captions: [{ text: "<p>つながり</p>", position: { x: 0.5, y: 0.5 } }] } } } },
          ],
        },
      };
      const bytes = Buffer.from(Buffer.from(JSON.stringify(miro)).map((byte) => (byte + 59) & 255));
      const html = `<meta charset="utf-8"><span data-meta="&lt;--(miro-data-v1)${bytes.toString("base64")}(/miro-data-v1)--&gt;"></span>`;
      await clickBoard(page, 700, 450);
      await page.mouse.move(canvas.x + 500, canvas.y + 450);
      await clipboard("paste", { "text/html": html, "text/plain": "Miroの付箋\nMiroの図形" });
      await expect(item(page, "Miroの付箋")).toHaveAttribute("data-type", "sticky");
      await expect(item(page, "Miroの付箋")).toHaveAttribute("style", /--color-wb-green/);
      await expect(item(page, "Miroの図形")).toHaveAttribute("data-type", "diamond");
      await expect(item(page, "Miroの図形")).toHaveAttribute("data-color", "transparent");
      // The connector between them (the one between the copied notes went with the cut).
      await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(1);
      await expect(page.getByTestId("Whiteboard.connectorLabel").filter({ hasText: "つながり" })).toHaveCount(1);

      // Text from elsewhere: a text box with it.
      await clickBoard(page, 100, 450);
      await clipboard("paste", { "text/plain": "貼り付けた文章\n二行目" });
      await expect(item(page, "貼り付けた文章")).toHaveAttribute("data-type", "text");

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

  test("a text item is as tall as its text: only its width changes; the placeholder goes as soon as IME input starts", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードのテキストの高さ");
      await page.getByTestId("Whiteboard.textToolButton").click();
      await clickBoard(page, 200, 120);
      const input = page.getByTestId("Whiteboard.textInput");
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("data-empty", "");
      // Japanese typed straight away (an IME composition): no placeholder over it.
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
      await expect(input).not.toHaveAttribute("data-empty");
      await cdp.send("Input.insertText", { text: "日本" });
      await expect(input).toHaveText("日本");
      await expect(input).not.toHaveAttribute("data-empty");

      const text = page.locator('[data-ui="Whiteboard.item"][data-type="text"]');
      const oneLine = (await text.boundingBox())!;
      for (const line of ["二行目", "三行目", "四行目"]) {
        await page.keyboard.press("Enter");
        await page.keyboard.type(line);
      }
      await page.keyboard.press("Escape");
      await expect(input).toHaveCount(0);
      await expect.poll(async () => (await text.boundingBox())!.height).toBeGreaterThan(oneLine.height * 3);
      const tall = (await text.boundingBox())!;

      // The height is kept in the board too: a selection box over the text's
      // bottom line only (below where the first line ends) takes it.
      const canvas = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      await page.mouse.click(canvas.x + 600, canvas.y + 400);
      await page.mouse.move(tall.x + tall.width + 30, tall.y + tall.height - 6);
      await page.mouse.down();
      await page.mouse.move(tall.x + tall.width - 10, tall.y + tall.height - 2, { steps: 4 });
      await page.mouse.up();
      await expect(text).toHaveAttribute("data-selected", "");

      // Resizing: the handle on its right edge changes the width alone.
      await text.click();
      const handle = text.getByTestId("Whiteboard.resizeHandle");
      const at = (await handle.boundingBox())!;
      await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
      await page.mouse.down();
      await page.mouse.move(at.x + 160, at.y + 200, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => Math.round((await text.boundingBox())!.width)).toBeGreaterThan(Math.round(tall.width) + 100);
      expect(Math.abs((await text.boundingBox())!.height - tall.height)).toBeLessThan(2);

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
      await expect(page.getByTestId("Notice")).toHaveText("同じ辺どうしで、同じオブジェクトを接続しているコネクターがすでにあります");
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

      // Two boxes already connected (from 始まり's right side), connected again
      // from another side: a second connector; from that side once more: not.
      const fromBottom = async () => {
        await page.keyboard.press("Escape");
        await item(page, "始まり").hover();
        const bottom = page.locator('[data-ui="Whiteboard.connectHandle"][data-id="bottom"]');
        const b = (await bottom.boundingBox())!;
        const t = (await item(page, "付け替え先").boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(t.x + 50, t.y + 50, { steps: 6 });
        await page.mouse.up();
      };
      await fromBottom();
      await expect(line).toHaveCount(3);
      await expect(line.nth(2)).toHaveAttribute("data-from-side", "bottom");
      await fromBottom();
      await expect(line).toHaveCount(3);
      await expect(page.getByTestId("Notice")).toHaveText("同じ辺どうしで、同じオブジェクトを接続しているコネクターがすでにあります");

      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("a connector inside a transparent frame can be clicked; new connectors take the last connector style", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの枠とコネクター");
      const canvas = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      // A frame: a rectangle, made transparent, then boxes on it.
      await page.getByTestId("Whiteboard.rectToolButton").click();
      await page.mouse.move(canvas.x + 60, canvas.y + 60);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 620, canvas.y + 280, { steps: 6 });
      await page.mouse.up();
      await page.keyboard.press("Escape");
      const frame = page.locator('[data-ui="Whiteboard.item"][data-type="rect"]');
      await frame.click({ position: { x: 20, y: 20 } });
      await page.locator('[data-ui="Whiteboard.colorButton"][data-id="transparent"]').click();
      await expect(frame).toHaveAttribute("data-color", "transparent");
      await page.keyboard.press("Escape");
      await addSticky(page, 170, 170, "枠の中A");
      await addSticky(page, 470, 170, "枠の中B");
      await addSticky(page, 470, 450, "枠の外");

      const connect = async (from: string, side: string, to: string) => {
        await item(page, from).hover();
        const dot = (await page.locator(`[data-ui="Whiteboard.connectHandle"][data-id="${side}"]`).boundingBox())!;
        const target = (await item(page, to).boundingBox())!;
        await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x + 50, target.y + 50, { steps: 6 });
        await page.mouse.up();
      };
      await connect("枠の中A", "right", "枠の中B");
      const line = page.getByTestId("Whiteboard.connector");
      await expect(line).toHaveCount(1);
      // Arrowheads on both ends, drawn dashed: remembered for the next ones.
      await page.locator('[data-ui="Whiteboard.arrowsButton"][data-id="both"]').click();
      await page.locator('[data-ui="Whiteboard.strokeButton"][data-id="dashed"]').click();
      await expect(line).toHaveAttribute("data-arrows", "both");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("Whiteboard.connectorEndHandle")).toHaveCount(0);

      // Clicked on its line inside the frame: the connector, not the frame.
      const l = (await line.boundingBox())!;
      await page.mouse.click(l.x + l.width / 2, l.y + l.height / 2);
      await expect(page.getByTestId("Whiteboard.connectorEndHandle")).toHaveCount(2);
      await expect(frame).not.toHaveAttribute("data-selected", "");
      // Elsewhere in the frame: the frame.
      await page.keyboard.press("Escape");
      await frame.click({ position: { x: 20, y: 200 } });
      await expect(frame).toHaveAttribute("data-selected", "");
      await page.keyboard.press("Escape");

      // A new connector looks like the last one styled.
      await connect("枠の中B", "bottom", "枠の外");
      await expect(line).toHaveCount(2);
      await expect(line.nth(1)).toHaveAttribute("data-arrows", "both");
      await expect(line.nth(1)).toHaveAttribute("data-stroke", "dashed");
      // Kept in this browser, after reloading too.
      await page.reload();
      await expect(item(page, "枠の外")).toBeVisible();
      await connect("枠の中A", "bottom", "枠の外");
      await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(3);
      await expect(page.getByTestId("Whiteboard.connector").nth(2)).toHaveAttribute("data-arrows", "both");

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

  test("Shift keeps a drag straight across or down; with Ctrl held as it ends, it copies", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの Shift");
      await addSticky(page, 200, 150, "Shift の付箋");
      const notes = item(page, "Shift の付箋");
      const start = (await notes.boundingBox())!;
      const [x0, y0] = [Math.round(start.x), Math.round(start.y)];
      const positions = async () =>
        (await notes.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))).map((r) => [Math.round(r.x), Math.round(r.y)]);
      const drag = async (from: [number, number], by: [number, number]) => {
        await page.mouse.move(from[0] + 20, from[1] + 20);
        await page.mouse.down();
        await page.mouse.move(from[0] + 20 + by[0], from[1] + 20 + by[1], { steps: 6 });
        await page.mouse.up();
      };

      // Mostly across: only across.
      await page.keyboard.down("Shift");
      await drag([x0, y0], [200, 40]);
      await page.keyboard.up("Shift");
      expect(await positions()).toEqual([[x0 + 200, y0]]);
      // Mostly down: only down. (Shift pressed on the selected note: kept
      // selected, as it was dragged.)
      await page.keyboard.down("Shift");
      await drag([x0 + 200, y0], [-30, 150]);
      await page.keyboard.up("Shift");
      expect(await positions()).toEqual([[x0 + 200, y0 + 150]]);
      await expect(notes).toHaveAttribute("data-selected", "");

      // Shift + Ctrl as it ends: a copy straight across, the original stays.
      await page.keyboard.down("Shift");
      await page.mouse.move(x0 + 220, y0 + 170);
      await page.mouse.down();
      await page.mouse.move(x0 + 20, y0 + 190, { steps: 6 });
      await page.keyboard.down("Control");
      await expect(page.getByTestId("Whiteboard.copyMark")).toHaveCount(1);
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.keyboard.up("Shift");
      await expect(notes).toHaveCount(2);
      expect(await positions()).toContainEqual([x0 + 200, y0 + 150]);
      expect(await positions()).toContainEqual([x0, y0 + 150]);

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

      // A sticky note made a rectangle, then an ellipse (from the bar's shape menu).
      await note.click();
      await page.getByTestId("Whiteboard.shapeMenuButton").click();
      await page.locator('[data-ui="Whiteboard.shapeButton"][data-id="rect"]').click();
      await expect(note).toHaveAttribute("data-type", "rect");
      await page.getByTestId("Whiteboard.shapeMenuButton").click();
      await page.locator('[data-ui="Whiteboard.shapeButton"][data-id="ellipse"]').click();
      await expect(note).toHaveAttribute("data-type", "ellipse");

      // Its background made transparent: the board shows through it.
      await page.locator('[data-ui="Whiteboard.colorButton"][data-id="transparent"]').click();
      await expect(note).toHaveAttribute("data-color", "transparent");
      await expect(note).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

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
      await expect(page.getByTestId("Whiteboard.textInput")).toHaveJSProperty("textContent", "買うもの\n- 牛乳\n- 卵\n以上");
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

  test("parts of a text made bold, italic, underlined, struck through or colored, kept after reloading", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの文字の装飾");
      await addSticky(page, 300, 200, "太字と赤字と普通");
      // By its id: its text changes.
      const noteId = await item(page, "太字と赤字と普通").getAttribute("data-id");
      const note = page.locator(`[data-ui="Whiteboard.item"][data-id="${noteId}"]`);
      const input = page.getByTestId("Whiteboard.textInput");
      const styleButton = (flag: string) => page.locator(`[data-ui="Whiteboard.textStyleButton"][data-id="${flag}"]`);
      const styled = (code: string) => input.locator(`span[data-s="${code}"]`);

      // The first word selected and made bold with the button (the text stays open).
      await note.dblclick();
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await styleButton("bold").click();
      await expect(styled("b")).toHaveText("太字");
      await expect(styleButton("bold")).toHaveAttribute("aria-pressed", "true");
      await expect(input).toBeFocused();

      // Typing inside the bold word: bold too.
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.type("い");
      await expect(styled("b")).toHaveText("太い字");

      // The second word colored red from the menu, and underlined with Ctrl+U.
      await page.keyboard.press("Control+Home");
      for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await page.getByTestId("Whiteboard.textColorButton").click();
      await expect(page.getByTestId("Whiteboard.textColorMenu")).toBeVisible();
      await page.locator('[data-ui="Whiteboard.textColorItem"][data-id="red"]').click();
      await expect(page.getByTestId("Whiteboard.textColorMenu")).toHaveCount(0);
      await page.keyboard.press("Control+u");
      await expect(styled("u c:red")).toHaveText("赤字");

      // Nothing selected: Ctrl+I and Ctrl+Shift+S for what's typed next.
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Control+i");
      await page.keyboard.press("Control+Shift+s");
      await expect(styleButton("italic")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.type("斜体");
      await expect(styled("i s")).toHaveText("斜体");
      await expect(input).toHaveJSProperty("textContent", "太い字と赤字と普通斜体");

      // Undo while typing: the board's undo, the field drawn again.
      await page.keyboard.press("Control+z");
      await expect(input).toHaveJSProperty("textContent", "太い字と赤字と普通");
      await page.keyboard.press("Escape");

      // Shown on the board in the styles.
      const shown = note.locator("span");
      await expect(shown.filter({ hasText: "太い字" })).toHaveCSS("font-weight", "700");
      await expect(shown.filter({ hasText: "赤字" })).toHaveCSS("color", "rgb(166, 27, 27)");
      await expect(shown.filter({ hasText: "赤字" })).toHaveCSS("text-decoration-line", "underline");
      await expect(shown.filter({ hasText: "普通" })).toHaveCount(0);

      // The whole note struck through from the bar (selected, not being edited); again takes it away.
      await expect(note).toHaveAttribute("data-selected", "");
      await styleButton("strike").click();
      await expect(styleButton("strike")).toHaveAttribute("aria-pressed", "true");
      await expect(shown.filter({ hasText: "普通" })).toHaveCSS("text-decoration-line", "line-through");
      await styleButton("strike").click();
      await expect(styleButton("strike")).toHaveAttribute("aria-pressed", "false");

      // Kept in the page's document.
      await page.reload();
      await expect(shown.filter({ hasText: "赤字" })).toHaveCSS("color", "rgb(166, 27, 27)");
      await expect(shown.filter({ hasText: "太い字" })).toHaveCSS("font-weight", "700");

      await trashOpenPage(page);
    } finally {
      await context.close();
    }
  });

  test("hexagons: drawn, resized and changed into, never taller than a regular one", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("editor") });
    const page = await context.newPage();
    try {
      await createWhiteboard(page, "E2E ホワイトボードの六角形");
      const c = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
      const draw = async (x: number, y: number, w: number, h: number, shift = false) => {
        await page.getByTestId("Whiteboard.hexagonToolButton").click();
        await page.mouse.move(c.x + x, c.y + y);
        await page.mouse.down();
        if (shift) await page.keyboard.down("Shift");
        await page.mouse.move(c.x + x + w, c.y + y + h, { steps: 6 });
        await page.mouse.up();
        if (shift) await page.keyboard.up("Shift");
        await page.keyboard.press("Escape");
      };
      const hexagons = page.locator('[data-ui="Whiteboard.item"][data-type="hexagon"]');
      const sizeOf = async (n: number) => {
        const b = (await hexagons.nth(n).boundingBox())!;
        return [Math.round(b.width), Math.round(b.height)];
      };
      // Flat: as dragged.
      await draw(60, 60, 240, 60);
      await expect(hexagons).toHaveCount(1);
      expect(await sizeOf(0)).toEqual([240, 60]);
      await expect(hexagons.nth(0).locator("polygon")).toHaveCount(1);
      // Dragged taller than a regular one: as tall as one (100 × 86).
      await draw(60, 200, 100, 200);
      await expect(hexagons).toHaveCount(2);
      expect(await sizeOf(1)).toEqual([100, 86]);
      // With Shift: a regular one, as wide as dragged.
      await draw(400, 60, 140, 30, true);
      await expect(hexagons).toHaveCount(3);
      expect(await sizeOf(2)).toEqual([140, 121]);

      // Made taller by its handle: no taller than a regular one.
      await hexagons.nth(0).click();
      const handle = hexagons.nth(0).getByTestId("Whiteboard.resizeHandle");
      const h = (await handle.boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 400, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => sizeOf(0)).toEqual([240, 207]);

      // Changed into from a sticky note (square): kept no taller than a regular one.
      await page.keyboard.press("Escape");
      await page.getByTestId("Whiteboard.stickyToolButton").click();
      await page.mouse.click(c.x + 700, c.y + 300);
      await page.keyboard.press("Escape");
      const sticky = page.locator('[data-ui="Whiteboard.item"][data-type="sticky"]');
      await expect(sticky).toHaveCount(1);
      await page.getByTestId("Whiteboard.shapeMenuButton").click();
      await page.locator('[data-ui="Whiteboard.shapeButton"][data-id="hexagon"]').click();
      await expect(hexagons).toHaveCount(4);
      expect(await sizeOf(3)).toEqual([100, 86]);

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
