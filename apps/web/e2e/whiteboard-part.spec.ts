import { readFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { addPageFromTree, createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// A part of a whiteboard: the items picked exported (PNG, SVG, PDF), the
// whole board as a PDF, and a whiteboard block in a document showing only
// some items or groups (a group with what's put in it later).
test.use({ storageState: authFile("editor") });

async function createWhiteboard(page: Page, label: string): Promise<{ id: string; title: string }> {
  await openPage(page, HOME_PAGE_ID);
  await addPageFromTree(page, HOME_PAGE_ID, "whiteboard");
  await page.waitForURL((url) => /\/pages\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith(`/${HOME_PAGE_ID}`));
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
  const title = `${label} ${Date.now()}`;
  await page.getByTestId("TitleField").fill(title);
  return { id: new URL(page.url()).pathname.split("/").pop()!, title };
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

const item = (scope: Page | ReturnType<Page["getByTestId"]>, text: string) => scope.getByTestId("Whiteboard.item").filter({ hasText: text });

async function download(page: Page, open: () => Promise<void>) {
  const file = page.waitForEvent("download", { timeout: 90_000 });
  await open();
  const done = await file;
  return { name: done.suggestedFilename(), data: await readFile((await done.path())!) };
}

test("the items picked are exported, the board as a PDF, and a document's block shows a part of it", async ({ page }) => {
  test.setTimeout(240_000);
  const board = await createWhiteboard(page, "E2E 一部のボード");
  await addSticky(page, 150, 150, "部分A");
  await addSticky(page, 350, 150, "部分B");
  await addSticky(page, 150, 400, "部分C");
  // A and B grouped.
  const from = await boardPoint(page, 50, 60);
  const to = await boardPoint(page, 470, 270);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Control+g");
  await expect(page.getByTestId("Whiteboard.groupFrame")).toHaveCount(1);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  // C alone, from the board's menu: only C is in the file.
  const c = (await item(page, "部分C").boundingBox())!;
  await page.mouse.click(c.x + 20, c.y + 20, { button: "right" });
  const svg = await download(page, () => page.getByTestId("Whiteboard.exportSVGMenuItem").click());
  expect(svg.name).toMatch(/\.svg$/);
  expect(svg.data.toString("utf8")).toContain("部分C");
  expect(svg.data.toString("utf8")).not.toContain("部分A");
  await page.mouse.click(c.x + 20, c.y + 20, { button: "right" });
  const png = await download(page, () => page.getByTestId("Whiteboard.exportPNGMenuItem").click());
  expect(png.data.subarray(1, 4).toString("latin1")).toBe("PNG");
  // Nothing picked: nothing to export.
  const empty = await boardPoint(page, 700, 480);
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(page.getByTestId("Whiteboard.exportPDFMenuItem")).toBeDisabled();
  await page.keyboard.press("Escape");

  // The group as a PDF, and the whole board from the page menu.
  const a = (await item(page, "部分A").boundingBox())!;
  await page.mouse.click(a.x + 20, a.y + 20, { button: "right" });
  const groupPdf = await download(page, () => page.getByTestId("Whiteboard.exportPDFMenuItem").click());
  expect(groupPdf.name).toMatch(/\.pdf$/);
  expect(groupPdf.data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await page.getByTestId("PageMenu.button").click();
  const boardPdf = await download(page, () => page.getByTestId("PageMenu.exportBoardPdf").click());
  expect(boardPdf.name).toBe(`${board.title}.pdf`);
  expect(boardPdf.data.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // A document showing the group only.
  await createPage(page, "E2E ボードの一部を表示する文書");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("/ホワイトボード");
  await page.getByRole("option", { name: /ホワイトボード/ }).first().click();
  await page.getByTestId("WhiteboardEmbed.chooseButton").click();
  await page.getByTestId("PagePickerDialog.pageSelect").selectOption(board.id);
  await page.getByTestId("PagePickerDialog.submitButton").click();
  const embed = page.getByTestId("WhiteboardEmbed");
  await expect(item(embed, "部分C")).toBeVisible();
  await expect(embed.getByTestId("WhiteboardEmbed.partialStatus")).toHaveCount(0);

  await embed.getByTestId("WhiteboardEmbed.rangeButton").click();
  const dialog = page.getByTestId("WhiteboardEmbed.rangeDialog");
  await expect(dialog.getByTestId("WhiteboardEmbed.rangeStatus")).toHaveText(/選んでいません/);
  // A click on A picks its group.
  await item(dialog, "部分A").click();
  await expect(dialog.getByTestId("WhiteboardEmbed.rangeStatus")).toHaveText("2個のオブジェクトを選んでいます");
  await dialog.getByTestId("WhiteboardEmbed.rangeApplyButton").click();
  await expect(dialog).toHaveCount(0);
  await expect(embed.getByTestId("WhiteboardEmbed.partialStatus")).toBeVisible();
  await expect(item(embed, "部分A")).toBeVisible();
  await expect(item(embed, "部分B")).toBeVisible();
  await expect(item(embed, "部分C")).toHaveCount(0);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  // Something put in the group on the board shows in the block, as it's made.
  await expect(embed).toHaveAttribute("data-live", "");
  const boardPage = await page.context().newPage();
  try {
    await boardPage.goto(`pages/${board.id}`);
    await expect(boardPage.getByTestId("Whiteboard.canvas")).toBeVisible();
    await addSticky(boardPage, 550, 150, "部分D");
    const groupA = (await item(boardPage, "部分A").boundingBox())!;
    await boardPage.mouse.click(groupA.x + 20, groupA.y + 20);
    const d = (await item(boardPage, "部分D").boundingBox())!;
    await boardPage.keyboard.down("Shift");
    await boardPage.mouse.click(d.x + 20, d.y + 20);
    await boardPage.keyboard.up("Shift");
    await boardPage.keyboard.press("Control+g");
    await expect(item(embed, "部分D")).toBeVisible();
    await expect(item(embed, "部分C")).toHaveCount(0);
    await expect(boardPage.getByTestId("PageView.status")).toHaveCount(0);
  } finally {
    await boardPage.close();
  }

  // Back to the whole board.
  await embed.getByTestId("WhiteboardEmbed.rangeButton").click();
  await dialog.getByTestId("WhiteboardEmbed.rangeClearButton").click();
  await expect(dialog.getByTestId("WhiteboardEmbed.rangeStatus")).toHaveText(/選んでいません/);
  await dialog.getByTestId("WhiteboardEmbed.rangeApplyButton").click();
  await expect(item(embed, "部分C")).toBeVisible();
  await expect(embed.getByTestId("WhiteboardEmbed.partialStatus")).toHaveCount(0);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  await trashOpenPage(page);
  await page.goto(`pages/${board.id}`);
  await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
  await trashOpenPage(page);
});

test("a link to objects opens the whiteboard at them, picked; someone who can only view copies one too", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const board = await createWhiteboard(page, "E2E オブジェクトへのリンク");
  await addSticky(page, 150, 150, "リンク元");
  await addSticky(page, 300, 300, "リンク先");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  const target = (await item(page, "リンク先").boundingBox())!;
  await page.mouse.click(target.x + 20, target.y + 20, { button: "right" });
  await page.getByTestId("Whiteboard.copyLinkMenuItem").click();
  await expect(page.getByTestId("Notice")).toHaveText(/リンクをコピーしました/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const id = await item(page, "リンク先").getAttribute("data-id");
  expect(new URL(link).pathname).toMatch(new RegExp(`/pages/${board.id}$`));
  expect(new URL(link).searchParams.get("items")).toBe(id);

  const viewer = await browser.newContext({ storageState: authFile("viewer") });
  const viewerPage = await viewer.newPage();
  try {
    await viewer.grantPermissions(["clipboard-read", "clipboard-write"]);
    await viewerPage.goto(link);
    await expect(viewerPage.getByTestId("Whiteboard.canvas")).toBeVisible();
    // Picked, and the view is centered on it.
    await expect(item(viewerPage, "リンク先")).toHaveAttribute("data-selected", "");
    await expect(item(viewerPage, "リンク元")).not.toHaveAttribute("data-selected", "");
    await expect(item(viewerPage, "リンク先")).toBeInViewport();
    const canvas = (await viewerPage.getByTestId("Whiteboard.canvas").boundingBox())!;
    const shown = (await item(viewerPage, "リンク先").boundingBox())!;
    expect(Math.abs(shown.x + shown.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(4);

    // Read-only: a click on the board lets go; a click picks another; the
    // menu has the link (and the exports), nothing that changes the board.
    await viewerPage.mouse.click(canvas.x + 10, canvas.y + canvas.height - 10);
    await expect(viewerPage.locator('[data-ui="Whiteboard.item"][data-selected]')).toHaveCount(0);
    const source = (await item(viewerPage, "リンク元").boundingBox())!;
    await viewerPage.mouse.click(source.x + 10, source.y + 10, { button: "right" });
    await expect(viewerPage.getByTestId("Whiteboard.deleteMenuItem")).toHaveCount(0);
    await expect(viewerPage.getByTestId("Whiteboard.exportSVGMenuItem")).toBeEnabled();
    await viewerPage.getByTestId("Whiteboard.copyLinkMenuItem").click();
    const viewerLink = await viewerPage.evaluate(() => navigator.clipboard.readText());
    expect(new URL(viewerLink).searchParams.get("items")).toBe(await item(viewerPage, "リンク元").getAttribute("data-id"));

    // Nothing left of what a link names: the whole board, and a note.
    await viewerPage.goto(`pages/${board.id}?items=gone`);
    await expect(viewerPage.getByTestId("Notice")).toHaveText(/もうホワイトボードにありません/);
    await expect(viewerPage.locator('[data-ui="Whiteboard.item"][data-selected]')).toHaveCount(0);
  } finally {
    await viewer.close();
  }
  await trashOpenPage(page);
});
