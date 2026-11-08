import { readFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { addPageFromTree, createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// A whiteboard's templates, lining up and snapping, links to pages, images,
// export, and whiteboards shown in documents.
test.use({ storageState: authFile("editor") });

async function createWhiteboard(page: Page, label: string, parentId = HOME_PAGE_ID): Promise<{ id: string; title: string }> {
  await openPage(page, parentId);
  await addPageFromTree(page, parentId, "whiteboard");
  await page.waitForURL((url) => /\/pages\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith(`/${parentId}`));
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
  const title = `${label} ${Date.now()}`;
  await page.getByTestId("TitleField").fill(title);
  return { id: new URL(page.url()).pathname.split("/").pop()!, title };
}

async function clickBoard(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("Whiteboard.canvas").boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

async function addSticky(page: Page, x: number, y: number, text: string) {
  await page.getByTestId("Whiteboard.stickyToolButton").click();
  await clickBoard(page, x, y);
  await page.getByTestId("Whiteboard.textInput").fill(text);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("Whiteboard.textInput")).toHaveCount(0);
}

// A file dropped onto the board at (x, y).
async function dropFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, x = 400, y = 300) {
  const canvas = page.getByTestId("Whiteboard.canvas");
  const box = (await canvas.boundingBox())!;
  const dataTransfer = await page.evaluateHandle(
    ({ name, mimeType, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: mimeType }));
      return transfer;
    },
    { name: file.name, mimeType: file.mimeType, data: file.buffer.toString("base64") },
  );
  await canvas.dispatchEvent("drop", { dataTransfer, clientX: box.x + x, clientY: box.y + y });
}

const item = (page: Page, text: string) => page.getByTestId("Whiteboard.item").filter({ hasText: text });

// A 2 × 1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC", "base64");

test.describe("Whiteboard tools", () => {
  test("templates go in as one step to undo; boxes line up, snap and link to pages", async ({ page }) => {
    test.setTimeout(120_000);
    await createWhiteboard(page, "E2E ホワイトボードの道具");

    // A template, in the middle of the screen, taken back with one undo.
    await page.getByTestId("Whiteboard.templatesButton").click();
    await page.locator('[data-ui="Whiteboard.templateItem"][data-id="kpt"]').click();
    await expect(item(page, "Keep：よかったこと")).toBeVisible();
    await expect(page.getByTestId("Whiteboard.item")).toHaveCount(10);
    await page.getByTestId("Whiteboard.canvas").focus();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("Whiteboard.item")).toHaveCount(0);
    await page.getByTestId("Whiteboard.templatesButton").click();
    await page.locator('[data-ui="Whiteboard.templateItem"][data-id="orgChart"]').click();
    await expect(page.getByTestId("Whiteboard.item")).toHaveCount(10);
    await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(9);
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("Whiteboard.item")).toHaveCount(0);

    // Two notes lined up by their tops.
    await addSticky(page, 150, 120, "上の付箋");
    await addSticky(page, 400, 260, "下の付箋");
    await item(page, "上の付箋").click();
    await item(page, "下の付箋").click({ modifiers: ["Shift"] });
    await page.locator('[data-ui="Whiteboard.alignButton"][data-id="top"]').click();
    await expect.poll(async () => (await item(page, "下の付箋").boundingBox())!.y).toBe((await item(page, "上の付箋").boundingBox())!.y);
    // The first selected is the key (marked); clicking the other selected one
    // makes it the key instead, both staying selected.
    const key = page.getByTestId("Whiteboard.alignKey");
    await expect(key).toHaveAttribute("data-id", (await item(page, "上の付箋").getAttribute("data-id"))!);
    const lowerX = (await item(page, "下の付箋").boundingBox())!.x;
    await item(page, "下の付箋").click();
    await expect(key).toHaveAttribute("data-id", (await item(page, "下の付箋").getAttribute("data-id"))!);
    await expect(page.locator('[data-ui="Whiteboard.item"][data-selected]')).toHaveCount(2);
    await page.locator('[data-ui="Whiteboard.alignButton"][data-id="left"]').click();
    await expect.poll(async () => (await item(page, "上の付箋").boundingBox())!.x).toBe(lowerX);
    expect((await item(page, "下の付箋").boundingBox())!.x).toBe(lowerX);

    // A note dragged near the other's left edge snaps to it, a guide showing meanwhile.
    await clickBoard(page, 600, 400);
    const target = (await item(page, "上の付箋").boundingBox())!;
    const moving = (await item(page, "下の付箋").boundingBox())!;
    await page.mouse.move(moving.x + 20, moving.y + 20);
    await page.mouse.down();
    await page.mouse.move(target.x + 3 + 20, moving.y + 180, { steps: 8 });
    await expect(page.getByTestId("Whiteboard.guide").first()).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId("Whiteboard.guide")).toHaveCount(0);
    await expect.poll(async () => Math.round((await item(page, "下の付箋").boundingBox())!.x)).toBe(Math.round(target.x));

    // A link to a page, chosen from those the user can see, and followed.
    await item(page, "上の付箋").click();
    await page.getByTestId("Whiteboard.linkButton").click();
    await page.getByTestId("PagePickerDialog.filterInput").fill("E2E ホーム");
    await page.getByTestId("PagePickerDialog.pageSelect").selectOption(HOME_PAGE_ID);
    await page.getByTestId("PagePickerDialog.submitButton").click();
    const badge = item(page, "上の付箋").getByTestId("Whiteboard.linkBadge");
    await expect(badge).toBeVisible();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    const boardUrl = page.url();
    await badge.click();
    await page.waitForURL(`**/pages/${HOME_PAGE_ID}`);
    await page.goto(boardUrl);
    await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
    await trashOpenPage(page);
  });

  test("connector ends meeting a box at one point are spread apart, or kept together if the box says so", async ({ page }) => {
    test.setTimeout(120_000);
    await createWhiteboard(page, "E2E ホワイトボードの線の端");
    await addSticky(page, 150, 100, "左の付箋");
    await addSticky(page, 550, 100, "右の付箋");
    await addSticky(page, 350, 330, "受ける付箋");
    const target = (await item(page, "受ける付箋").boundingBox())!;
    // From each note's bottom dot into the top of the one below, turning at right angles.
    for (const from of ["左の付箋", "右の付箋"]) {
      await page.keyboard.press("Escape");
      await item(page, from).hover();
      const dot = (await page.locator('[data-ui="Whiteboard.connectHandle"][data-id="bottom"]').boundingBox())!;
      await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + 6, { steps: 6 });
      await page.mouse.up();
      await page.locator('[data-ui="Whiteboard.routeButton"][data-id="elbow"]').click();
    }
    await expect(page.getByTestId("Whiteboard.connector")).toHaveCount(2);
    const ends = async () => {
      const ds = await page.locator('[data-ui="Whiteboard.connector"] path:nth-child(2)').evaluateAll((paths) => paths.map((p) => p.getAttribute("d")!));
      return ds.map((d) => {
        const n = d.match(/-?[\d.]+/g)!.map(Number);
        return Math.round(n[n.length - 2]);
      });
    };
    // Spread: the left one's end on the left.
    await expect.poll(async () => new Set(await ends()).size).toBe(2);
    const [left, right] = await ends();
    expect(left).toBeLessThan(right);

    // Kept together, from the box's selection bar.
    await item(page, "受ける付箋").click();
    await expect(page.locator('[data-ui="Whiteboard.connectorEndsButton"][data-id="spread"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-ui="Whiteboard.connectorEndsButton"][data-id="merge"]').click();
    await expect.poll(async () => new Set(await ends()).size).toBe(1);
    await page.locator('[data-ui="Whiteboard.connectorEndsButton"][data-id="spread"]').click();
    await expect.poll(async () => new Set(await ends()).size).toBe(2);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("images are dropped onto the board, and the board is exported as SVG and PNG", async ({ page }) => {
    test.setTimeout(120_000);
    await createWhiteboard(page, "E2E ホワイトボードの画像");
    await addSticky(page, 200, 150, "画像の横の付箋");
    // Dropped onto the board (the toolbar has no image button).
    await expect(page.getByTestId("Whiteboard.imageButton")).toHaveCount(0);
    await dropFile(page, { name: "dot.png", mimeType: "image/png", buffer: PNG });
    const image = page.getByTestId("Whiteboard.image");
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(2);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Not a picture: refused.
    await dropFile(page, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("Whiteboard.image")).toHaveCount(1);

    const exported = async (format: "Svg" | "Png") => {
      await page.getByTestId("PageMenu.button").click();
      const download = page.waitForEvent("download");
      await page.getByTestId(`PageMenu.export${format}`).click();
      const file = await download;
      return { name: file.suggestedFilename(), data: await readFile((await file.path())!) };
    };
    const svg = await exported("Svg");
    expect(svg.name).toMatch(/^E2E ホワイトボードの画像 \d+\.svg$/);
    const text = svg.data.toString("utf8");
    expect(text).toContain("画像の横の付箋");
    // The image is in the file itself.
    expect(text).toContain('href="data:image/png;base64,');
    const png = await exported("Png");
    expect(png.name).toMatch(/\.png$/);
    expect(png.data.subarray(1, 4).toString("latin1")).toBe("PNG");
    await trashOpenPage(page);
  });

  test("a whiteboard shown in a document, to each viewer with their own access", async ({ page, browser }) => {
    test.setTimeout(150_000);
    const board = await createWhiteboard(page, "E2E 埋め込むボード");
    await addSticky(page, 200, 150, "埋め込みの付箋");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Another in the editor's own personal root, which nobody else can open.
    await openPage(page, HOME_PAGE_ID);
    const personalRootId = (await page
      .locator('[data-ui="Sidebar.root"]')
      .filter({ has: page.getByTestId("DocTree.rootBadge") })
      .locator('[data-ui="DocTree.link"]')
      .first()
      .getAttribute("data-id"))!;
    const secret = await createWhiteboard(page, "E2E 自分専用のボード", personalRootId);
    await addSticky(page, 200, 150, "見せない付箋");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    const doc = await createPage(page, "E2E ボードを表示する文書");
    await editorBody(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("/ホワイトボード");
    await page.getByRole("option", { name: /ホワイトボード/ }).first().click();
    await page.getByTestId("WhiteboardEmbed.chooseButton").click();
    // Only whiteboards can be chosen.
    await expect(page.locator(`[data-ui="PagePickerDialog.pageSelect"] option[value="${HOME_PAGE_ID}"]`)).toBeDisabled();
    await page.getByTestId("PagePickerDialog.pageSelect").selectOption(board.id);
    await page.getByTestId("PagePickerDialog.submitButton").click();
    const embed = page.getByTestId("WhiteboardEmbed");
    await expect(embed.getByTestId("WhiteboardEmbed.openLink")).toHaveText(board.title);
    await expect(embed.getByTestId("Whiteboard.item").filter({ hasText: "埋め込みの付箋" })).toBeVisible();
    // Read-only: no tools.
    await expect(embed.getByTestId("Whiteboard.toolbar")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Someone with access to both sees it.
    const viewer = await browser.newContext({ storageState: authFile("viewer") });
    const viewerPage = await viewer.newPage();
    try {
      await openPage(viewerPage, doc.id);
      await expect(viewerPage.getByTestId("WhiteboardEmbed").getByTestId("Whiteboard.item").filter({ hasText: "埋め込みの付箋" })).toBeVisible();

      // Live: what's added on the board shows in the document as it's made,
      // and so does a new title.
      await expect(viewerPage.getByTestId("WhiteboardEmbed")).toHaveAttribute("data-live", "");
      const boardPage = await page.context().newPage();
      try {
        await boardPage.goto(`pages/${board.id}`);
        await expect(boardPage.getByTestId("Whiteboard.canvas")).toBeVisible();
        await addSticky(boardPage, 420, 300, "あとから足した付箋");
        await expect(viewerPage.getByTestId("WhiteboardEmbed").getByTestId("Whiteboard.item").filter({ hasText: "あとから足した付箋" })).toBeVisible();
        await boardPage.getByTestId("TitleField").fill(`${board.title} 改`);
        await expect(viewerPage.getByTestId("WhiteboardEmbed.openLink")).toHaveText(`${board.title} 改`);
        await expect(boardPage.getByTestId("PageView.status")).toHaveCount(0);
      } finally {
        await boardPage.close();
      }

      // The editor shows their personal whiteboard instead: the viewer can't
      // open it, so gets neither the board nor its title.
      await page.getByTestId("WhiteboardEmbed.changeButton").click();
      await page.getByTestId("PagePickerDialog.pageSelect").selectOption(secret.id);
      await page.getByTestId("PagePickerDialog.submitButton").click();
      await expect(embed.getByTestId("WhiteboardEmbed.openLink")).toHaveText(secret.title);
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await viewerPage.reload();
      await expect(viewerPage.getByTestId("WhiteboardEmbed.status")).toHaveText(/表示できません/);
      await expect(viewerPage.getByText(secret.title)).toHaveCount(0);
      await expect(viewerPage.getByText("見せない付箋")).toHaveCount(0);
    } finally {
      await viewer.close();
    }
    await trashOpenPage(page);
    await page.goto(`pages/${secret.id}`);
    await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
    await page.getByTestId("PageMenu.button").click();
    await page.getByTestId("PageMenu.delete").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await page.goto(`pages/${board.id}`);
    await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
    await trashOpenPage(page);
  });
});
