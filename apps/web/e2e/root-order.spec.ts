import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { openPage } from "./helpers";

// The knowledge roots, top to bottom, as the sidebar lists them.
const rootNames = (page: import("@playwright/test").Page) =>
  page.locator('[data-ui="Sidebar.root"] > [data-ui="DocTree"] > ul > li > [data-ui="DocTree.row"] [data-ui="DocTree.link"]').allTextContents();

const rootRow = (page: import("@playwright/test").Page, name: string) =>
  page
    .locator('[data-ui="Sidebar.root"] > [data-ui="DocTree"] > ul > li > [data-ui="DocTree.row"]')
    .filter({ has: page.getByText(name, { exact: true }) });

test.describe("ナレッジルートの並び順", () => {
  test.use({ storageState: authFile("editor") });

  test("左ペインでルートをドラッグして並び替えられ、ほかの人には影響しない", async ({ page, browser }) => {
    await openPage(page, HOME_PAGE_ID);
    // Creation order to begin with (the seed resets everyone's order).
    let names = await rootNames(page);
    expect(names.indexOf("E2E")).toBeLessThan(names.indexOf("E2E サブ"));

    // E2E サブ dragged onto the top half of E2E's row, with real mouse moves.
    const from = (await rootRow(page, "E2E サブ").boundingBox())!;
    const to = (await rootRow(page, "E2E").boundingBox())!;
    await page.mouse.move(from.x + 60, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 64, from.y + from.height / 2 - 4, { steps: 5 });
    await page.mouse.move(to.x + 60, to.y + 4, { steps: 15 });
    await page.mouse.up();
    // Now right before E2E (other roots, like マイページ, may come first).
    const subFirst = async () => {
      const now = await rootNames(page);
      return now.indexOf("E2E サブ") === now.indexOf("E2E") - 1;
    };
    await expect.poll(subFirst).toBe(true);
    // The page tree inside was left alone.
    await expect(page.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`)).toBeVisible();

    // Kept on the server.
    await page.reload();
    await expect.poll(subFirst).toBe(true);

    // Someone else's sidebar is unchanged.
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const viewer = await viewerContext.newPage();
    try {
      await openPage(viewer, HOME_PAGE_ID);
      names = await rootNames(viewer);
      expect(names.indexOf("E2E")).toBeLessThan(names.indexOf("E2E サブ"));
    } finally {
      await viewerContext.close();
    }

    // From the keyboard: Alt+↓ on a root's link moves it down.
    await rootRow(page, "E2E サブ").getByTestId("DocTree.link").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(async () => {
        const now = await rootNames(page);
        return now.indexOf("E2E") < now.indexOf("E2E サブ");
      })
      .toBe(true);
  });
});