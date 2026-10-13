import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { editorBody, openPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("狭い画面（600px 未満）", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("左ペインは隠れていて、左上のメニューボタンで出し入れできる", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    const sidebar = page.getByTestId("AppShell.sidebar");
    const button = page.getByTestId("AppShell.menuButton");
    await expect(sidebar).toBeHidden();
    await expect(button).toBeVisible();
    // The content has the whole width, and the page's own bar is still usable.
    const body = (await editorBody(page).boundingBox())!;
    expect(body.width).toBeGreaterThan(350);
    await expect(page.getByTestId("PageMenu.button")).toBeVisible();
    const menuBox = (await button.boundingBox())!;
    expect(menuBox.x).toBeLessThan(20);
    expect(menuBox.y).toBeLessThan(20);

    await button.click();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toBeInViewport();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`)).toBeVisible();
    // The drawer is as tall as the screen.
    expect((await sidebar.boundingBox())!.height).toBe(800);

    // Tapping outside closes it.
    await page.getByTestId("AppShell.backdrop").click({ position: { x: 370, y: 400 } });
    await expect(sidebar).toBeHidden();

    // Esc and the close button too.
    await button.click();
    await expect(sidebar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await button.click();
    await page.getByTestId("AppShell.closeButton").click();
    await expect(sidebar).toBeHidden();
  });

  test("メニューからページを開くと、メニューは閉じる", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    await page.getByTestId("AppShell.menuButton").click();
    await page.getByTestId("Sidebar.trashLink").click();
    await expect(page).toHaveURL(/\/trash$/);
    await expect(page.getByTestId("AppShell.sidebar")).toBeHidden();
    await expect(page.getByTestId("TrashPage")).toBeVisible();
  });
});

test.describe("広い画面", () => {
  test("左ペインは常に表示され、メニューボタンは出ない", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    await expect(page.getByTestId("AppShell.sidebar")).toBeVisible();
    await expect(page.getByTestId("AppShell.menuButton")).toBeHidden();
    await expect(page.getByTestId("AppShell.closeButton")).toBeHidden();
  });
});
