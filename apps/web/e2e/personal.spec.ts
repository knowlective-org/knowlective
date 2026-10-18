import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { editorBody, openPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// The open user's personal root, as the sidebar shows it.
const personalRow = (page: import("@playwright/test").Page) =>
  page.locator('[data-ui="Sidebar.root"]').filter({ has: page.getByTestId("DocTree.rootBadge") });

async function openPersonalRoot(page: import("@playwright/test").Page): Promise<string> {
  await openPage(page, HOME_PAGE_ID);
  const link = personalRow(page).locator('[data-ui="DocTree.link"]').first();
  const id = (await link.getAttribute("data-id"))!;
  await link.click();
  await page.waitForURL(new RegExp(`/pages/${id}$`));
  await expect(editorBody(page)).toBeVisible();
  return id;
}

test.describe("Personal knowledge root", () => {
  test("only the owner can see it, and it can't be shared or moved out of", async ({ page, browser }) => {
    // Everyone has exactly one, marked in the sidebar.
    await openPage(page, HOME_PAGE_ID);
    await expect(personalRow(page)).toHaveCount(1);
    await expect(personalRow(page).getByTestId("DocTree.rootBadge")).toHaveText("自分専用");

    // Pages can be added under it, as in any root.
    const rootId = await openPersonalRoot(page);
    await page.locator(`[data-ui="DocTree.link"][data-id="${rootId}"]`).hover();
    await page.locator(`[data-ui="DocTree.addChildButton"][data-id="${rootId}"]`).click();
    await page.waitForURL((url) => /\/pages\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith(rootId));
    await expect(editorBody(page)).toBeVisible();
    const childId = new URL(page.url()).pathname.split("/").pop()!;
    await page.getByTestId("TitleField").fill("自分だけのメモ");

    // Nothing to share: no permission settings.
    await page.getByTestId("PageMenu.button").click();
    await expect(page.getByTestId("PageMenu.permissions")).toHaveCount(0);
    await expect(page.locator('[data-ui="PageMenu.item"][data-label="権限設定"]')).toContainText("自分専用");
    // The move dialog only offers places in the same personal root.
    await page.getByTestId("PageMenu.move").click();
    const options = await page.getByTestId("MoveDialog.parentSelect").locator("option").allTextContents();
    expect(options.some((o) => o.includes("E2E ホーム"))).toBe(false);
    await page.getByTestId("MoveDialog.cancelButton").click();

    // Nobody else can open it — a site admin included.
    for (const role of ["viewer", "admin"] as const) {
      const context = await browser.newContext({ storageState: authFile(role) });
      const other = await context.newPage();
      try {
        for (const id of [rootId, childId]) {
          const response = await other.goto(`pages/${id}`);
          expect(response?.status()).toBe(404);
        }
        // Their own personal root is a different one.
        await openPage(other, HOME_PAGE_ID);
        await expect(personalRow(other)).toHaveCount(1);
        await expect(other.locator(`[data-ui="DocTree.link"][data-id="${rootId}"]`)).toHaveCount(0);
        // Not found by search either.
        await other.goto(`search?q=${encodeURIComponent("自分だけのメモ")}`);
        await expect(other.locator(`a[href$="/pages/${childId}"]`)).toHaveCount(0);
      } finally {
        await context.close();
      }
    }

    // Clean up: the page goes to the trash (the personal root itself stays).
    await openPage(page, childId);
    await page.getByTestId("PageMenu.button").click();
    await page.getByTestId("PageMenu.delete").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await page.waitForURL(new RegExp(`/pages/${rootId}$`));
  });

  test("pages from other knowledge roots can't be moved into a personal root", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    // As the move dialog lists them: no personal root among the places.
    await page.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`).click();
    await page.getByTestId("PageMenu.button").click();
    await page.getByTestId("PageMenu.move").click();
    const options = await page.getByTestId("MoveDialog.parentSelect").locator("option").allTextContents();
    expect(options.some((o) => o.includes("マイページ"))).toBe(false);
    await page.getByTestId("MoveDialog.cancelButton").click();
  });
});