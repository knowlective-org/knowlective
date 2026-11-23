import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { addPageFromTree, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// Adds a presentation under the E2E home page and titles it.
async function createPresentation(page: Page, label: string): Promise<{ id: string; title: string }> {
  await openPage(page, HOME_PAGE_ID);
  await addPageFromTree(page, HOME_PAGE_ID, "presentation");
  await page.waitForURL((url) => /\/pages\/(?!e2e-home)[^/]+$/.test(url.pathname));
  await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(1);
  await expect(page.getByTestId("Whiteboard.slideFrame")).toBeVisible();
  const title = `${label} ${Date.now()}`;
  await page.getByTestId("TitleField").fill(title);
  return { id: new URL(page.url()).pathname.split("/").pop()!, title };
}

const slideIds = (page: Page) =>
  page.getByTestId("PresentationEditor.slideRow").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-id")!));

async function addSticky(page: Page, text: string) {
  await page.getByTestId("Whiteboard.stickyToolButton").click();
  const box = (await page.getByTestId("Whiteboard.slideFrame").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("Whiteboard.textInput").fill(text);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("Whiteboard.textInput")).toHaveCount(0);
}

async function openDeck(page: Page, id: string, title: string) {
  await page.goto(`pages/${id}`);
  await expect(page.getByTestId("TitleField")).toHaveValue(title);
}

const row = (page: Page, id: string) => page.locator(`[data-ui="PresentationEditor.slideRow"][data-id="${id}"]`);

test.describe("Presentation", () => {
  test("slides are added, edited live, reordered, numbered and hidden", async ({ page, browser }) => {
    const { id } = await createPresentation(page, "E2E プレゼン");
    const [first] = await slideIds(page);
    await addSticky(page, "一枚目の付箋");

    await page.getByTestId("PresentationEditor.addSlideButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    const second = (await slideIds(page)).find((s) => s !== first)!;
    await expect(row(page, second)).toHaveAttribute("data-current", "");
    await expect(page.getByTestId("Whiteboard.item")).toHaveCount(0);

    // Someone else sees the open slide change as it's edited.
    const otherContext = await browser.newContext({ storageState: authFile("admin") });
    const other = await otherContext.newPage();
    try {
      await other.goto(`pages/${id}?slide=${second}`);
      await expect(other.getByTestId("Whiteboard.slideFrame")).toBeVisible();
      await addSticky(page, "二枚目の付箋");
      await expect(other.getByTestId("Whiteboard.item").filter({ hasText: "二枚目の付箋" })).toBeVisible();
    } finally {
      await otherContext.close();
    }

    // A slide isn't a page of its own: its address opens the presentation.
    await page.goto(`pages/${first}`);
    await page.waitForURL((url) => url.pathname.endsWith(`/pages/${id}`) && url.searchParams.get("slide") === first);
    await expect(page.getByTestId("Whiteboard.item").filter({ hasText: "一枚目の付箋" })).toBeVisible();
    await expect(page.locator(`[data-ui="DocTree.link"][href$="/pages/${first}"]`)).toHaveCount(0);

    // Dragging the second slide above the first.
    await row(page, second).dragTo(row(page, first), { targetPosition: { x: 40, y: 4 } });
    await expect.poll(() => slideIds(page)).toEqual([second, first]);
    await page.reload();
    await expect.poll(() => slideIds(page)).toEqual([second, first]);

    // Numbers: a slide with its number hidden still counts, a hidden one doesn't.
    await page.getByTestId("NumberingForm.toggle").click();
    await page.getByTestId("NumberingForm.enabledCheckbox").check();
    await row(page, first).getByRole("button", { name: /スライド 2 を開く/ }).click();
    await expect(page.getByTestId("Whiteboard.slideNumber")).toHaveText("2");
    await row(page, second).hover();
    await row(page, second).getByTestId("PresentationEditor.hideNumberButton").click();
    await expect(row(page, second).getByTestId("PresentationEditor.hideNumberButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("Whiteboard.slideNumber")).toHaveText("2");
    await row(page, second).hover();
    await row(page, second).getByTestId("PresentationEditor.hideSlideButton").click();
    await expect(row(page, second).getByTestId("PresentationEditor.hiddenStatus")).toBeVisible();
    await expect(page.getByTestId("Whiteboard.slideNumber")).toHaveText("1");

    await trashOpenPage(page);
  });

  test("a presenter asks everyone to switch, and those who accept follow", async ({ page, browser }) => {
    const { id } = await createPresentation(page, "E2E 発表");
    await addSticky(page, "発表の一枚目");
    await page.getByTestId("PresentationEditor.addSlideButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    const [first, second] = await slideIds(page);
    await row(page, first).getByTestId("PresentationEditor.slideButton").click();

    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const viewer = await viewerContext.newPage();
    const admin = await adminContext.newPage();
    try {
      await viewer.goto(`pages/${id}`);
      await admin.goto(`pages/${id}`);
      await expect(viewer.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
      await expect(admin.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);

      await page.getByTestId("PresentationEditor.presentButton").click();
      await page.getByRole("button", { name: "参照中の全員に切り替えをリクエスト" }).click();
      await expect(page.getByTestId("PresentationScreen")).toHaveAttribute("data-id", first);

      // Nobody is switched without saying so.
      await expect(viewer.getByTestId("PresentationEditor.presentRequest")).toBeVisible();
      await expect(admin.getByTestId("PresentationEditor.presentRequest")).toBeVisible();
      await expect(viewer.getByTestId("PresentationScreen")).toHaveCount(0);

      await viewer.getByTestId("PresentationEditor.joinButton").click();
      await expect(viewer.getByTestId("PresentationScreen")).toHaveAttribute("data-id", first);
      await admin.getByTestId("PresentationEditor.declineButton").click();
      await expect(admin.getByTestId("PresentationEditor.rejoinButton")).toBeVisible();

      // The one following goes where the presenter goes, and can't go alone.
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("PresentationScreen")).toHaveAttribute("data-id", second);
      await expect(viewer.getByTestId("PresentationScreen")).toHaveAttribute("data-id", second);
      await viewer.keyboard.press("ArrowLeft");
      await expect(viewer.getByTestId("PresentationScreen")).toHaveAttribute("data-id", second);
      await expect(admin.getByTestId("PresentationScreen")).toHaveCount(0);

      // A slide hidden while it's shown: the presenter moves on.
      await admin.locator(`[data-ui="PresentationEditor.slideRow"][data-id="${second}"]`).hover();
      await admin.locator(`[data-ui="PresentationEditor.slideRow"][data-id="${second}"]`).getByTestId("PresentationEditor.hideSlideButton").click();
      await expect(page.getByTestId("PresentationScreen")).toHaveAttribute("data-id", first);
      await expect(viewer.getByTestId("PresentationScreen")).toHaveAttribute("data-id", first);

      await page.getByTestId("PresentationScreen").hover();
      await page.getByTestId("PresentationScreen.exitButton").click();
      await expect(page.getByTestId("PresentationScreen")).toHaveCount(0);
      await expect(viewer.getByTestId("PresentationScreen.status").or(viewer.getByTestId("PresentationScreen.endedStatus"))).toHaveText("発表が終わりました。");
    } finally {
      await viewerContext.close();
      await adminContext.close();
    }
    await trashOpenPage(page);
  });

  test("the PDF has a page per shown slide, with real text", async ({ page }) => {
    const { id } = await createPresentation(page, "E2E PDF");
    await addSticky(page, "PDFに入る文字 한글 😀");
    await page.getByTestId("PresentationEditor.addSlideButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    await expect(page.getByTestId("Whiteboard.slideFrame")).toBeVisible();
    await addSticky(page, "非表示のスライドの文字");
    const [, second] = await slideIds(page);
    await row(page, second).hover();
    await row(page, second).getByTestId("PresentationEditor.hideSlideButton").click();
    await expect(row(page, second).getByTestId("PresentationEditor.hiddenStatus")).toBeVisible();
    // The edits have reached the server (the export reads its copy).
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    await page.getByTestId("PageMenu.button").click();
    const download = page.waitForEvent("download", { timeout: 120_000 });
    await page.getByTestId("PageMenu.exportPresentationPdf").click();
    const file = await (await download).path();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
    expect(pdf.numPages).toBe(1);
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
    expect(text).toContain("PDFに入る文字");
    expect(text).toContain("한글");
    expect(text).not.toContain("非表示のスライドの文字");
    await trashOpenPage(page);
    void id;
  });

  test("notes reach only editors, and the whole presentation can be restored", async ({ page, browser }) => {
    const { id } = await createPresentation(page, "E2E 履歴");
    await addSticky(page, "戻す前の付箋");
    const secretNote = `ノート ${Date.now()}`;
    await page.getByTestId("SlideNotes.textInput").fill(secretNote);
    await page.getByTestId("SlideNotes.textInput").blur();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Someone who can only view gets no notes, in the screen or from the server's document.
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const viewer = await viewerContext.newPage();
    try {
      await viewer.goto(`pages/${id}`);
      await expect(viewer.getByTestId("Whiteboard.slideFrame")).toBeVisible();
      await expect(viewer.getByTestId("SlideNotes")).toHaveCount(0);
      expect(await viewer.content()).not.toContain(secretNote);
    } finally {
      await viewerContext.close();
    }

    // A change: the state before it is recorded.
    await page.reload();
    await expect(page.getByTestId("SlideNotes.textInput")).toHaveValue(secretNote);
    await page.getByTestId("PresentationEditor.addSlideButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);

    await page.goto(`pages/${id}/history`);
    await expect(page.getByTestId("PresentationHistory.snapshotRow").first()).toBeVisible();
    await page.getByTestId("PresentationHistory.restoreButton").last().click();
    await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("PresentationHistory.status")).toBeVisible({ timeout: 30_000 });

    await page.goto(`pages/${id}`);
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(1);
    await expect(page.getByTestId("Whiteboard.item").filter({ hasText: "戻す前の付箋" })).toBeVisible();
    // The oldest snapshot is from just before the first note.
    await expect(page.getByTestId("SlideNotes.textInput")).toHaveValue("");

    // What the restore replaced is in the history, notes and slides included.
    await page.goto(`pages/${id}/history`);
    await page.getByTestId("PresentationHistory.snapshotRow").filter({ hasText: "復元の直前" }).getByTestId("PresentationHistory.restoreButton").click();
    await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
    await expect(page.getByTestId("PresentationHistory.status")).toBeVisible({ timeout: 30_000 });
    await page.goto(`pages/${id}`);
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    await page.getByTestId("PresentationEditor.slideButton").first().click();
    await expect(page.getByTestId("SlideNotes.textInput")).toHaveValue(secretNote);
    await trashOpenPage(page);
  });

  test("search finds a slide once and opens it in its presentation", async ({ page }) => {
    const { id, title } = await createPresentation(page, "E2E プレゼン検索");
    const word = `検索語${Date.now()}`;
    await addSticky(page, word);
    const [slide] = await slideIds(page);
    await page.getByTestId("PresentationEditor.addSlideButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    await expect(page.getByTestId("Whiteboard.slideFrame")).toBeVisible();
    await addSticky(page, word);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    await expect
      .poll(
        async () => {
          await page.goto(`search?q=${encodeURIComponent(word)}&mode=keyword`);
          return page.getByTestId("SearchPage.result").count();
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    const result = page.getByTestId("SearchPage.result");
    await expect(result).toContainText(title);
    await result.getByRole("link", { name: title }).click();
    await page.waitForURL((url) => url.pathname.endsWith(`/pages/${id}`) && !!url.searchParams.get("slide"));
    expect([slide, ...(await slideIds(page))]).toContain(new URL(page.url()).searchParams.get("slide"));
    await trashOpenPage(page);
  });

  test("text size and background are kept, and a slide can be dragged to another presentation", async ({ page }) => {
    const target = await createPresentation(page, "E2E 移動先");
    const { id, title } = await createPresentation(page, "E2E 移動元");
    await page.getByTestId("PresentationEditor.addSlideButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    await expect(page.getByTestId("Whiteboard.slideFrame")).toBeVisible();
    await addSticky(page, "大きな文字");
    const sticky = page.getByTestId("Whiteboard.item").filter({ hasText: "大きな文字" });
    await sticky.click();
    await page.getByTestId("Whiteboard.fontSizeSelect").selectOption("48");
    await page.locator('[data-ui="SlideBackgroundBar.colorButton"][data-id="blue"]').click();
    await expect(page.locator('[data-ui="SlideBackgroundBar.colorButton"][data-id="blue"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    const moved = new URL(page.url()).searchParams.get("slide")!;
    await page.reload();
    await expect(page.locator('[data-ui="SlideBackgroundBar.colorButton"][data-id="blue"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("Whiteboard.item").filter({ hasText: "大きな文字" }).locator("div").first()).toHaveCSS("font-size", "48px");

    // Into the other presentation, on its row in the sidebar.
    await row(page, moved).dragTo(page.locator(`[data-ui="DocTree.link"][data-id="${target.id}"]`));
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(1);
    await page.goto(`pages/${target.id}?slide=${moved}`);
    await expect(page.getByTestId("PresentationEditor.slideRow")).toHaveCount(2);
    await expect(page.getByTestId("Whiteboard.item").filter({ hasText: "大きな文字" })).toBeVisible();
    await trashOpenPage(page);
    await openDeck(page, id, title);
    await trashOpenPage(page);
  });

  test("someone with view access can look but not change anything", async ({ page, browser }) => {
    const { id } = await createPresentation(page, "E2E プレゼン閲覧");
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const viewer = await viewerContext.newPage();
    try {
      await viewer.goto(`pages/${id}`);
      await expect(viewer.getByTestId("Whiteboard.slideFrame")).toBeVisible();
      await expect(viewer.getByTestId("PresentationEditor.addSlideButton")).toHaveCount(0);
      await expect(viewer.getByTestId("PresentationEditor.deleteSlideButton")).toHaveCount(0);
      await expect(viewer.getByTestId("NumberingForm")).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
    await trashOpenPage(page);
  });
});
