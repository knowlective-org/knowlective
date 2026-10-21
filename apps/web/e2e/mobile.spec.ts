import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("Narrow screens (under 600px)", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("the sidebar is hidden and toggled by the menu button at the top left", async ({ page }) => {
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

  test("opening a page from the menu closes the menu", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    await page.getByTestId("AppShell.menuButton").click();
    await page.getByTestId("Sidebar.trashLink").click();
    await expect(page).toHaveURL(/\/trash$/);
    await expect(page.getByTestId("AppShell.sidebar")).toBeHidden();
    await expect(page.getByTestId("TrashPage")).toBeVisible();
  });
});

test.describe("Wide screens", () => {
  test("the sidebar is always shown, with no menu button", async ({ page }) => {
    await openPage(page, HOME_PAGE_ID);
    await expect(page.getByTestId("AppShell.sidebar")).toBeVisible();
    await expect(page.getByTestId("AppShell.menuButton")).toBeHidden();
    await expect(page.getByTestId("AppShell.closeButton")).toBeHidden();
  });

  test("the page takes the whole width beside the sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openPage(page, HOME_PAGE_ID);
    const sidebar = (await page.getByTestId("AppShell.sidebar").boundingBox())!;
    const body = (await editorBody(page).boundingBox())!;
    expect(body.x).toBeLessThan(sidebar.x + sidebar.width + 80);
    expect(body.width).toBeGreaterThan(1600 - sidebar.width - 160);
  });
});

test.describe("Touch screens", () => {
  test.use({ hasTouch: true });

  // A phone browser dropped the first tap's click (BlockNote's side menu
  // appears on the tap's simulated mousemove), so PageLink opens on touchend.
  test("a link in a child page block opens on the first tap", async ({ page }) => {
    const parent = await createPage(page, "E2E タップ");
    await editorBody(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("/kanban");
    await page.getByRole("option", { name: /子ページボード/ }).click();
    await page.getByTestId("ChildBoardBlock.createStatusButton").click();
    await page.getByTestId("ChildBoardBlock.addCardButton").first().click();
    await page.getByTestId("ChildBoardBlock.addCardInput").fill("タップで開くページ");
    await page.keyboard.press("Enter");
    const card = page.getByTestId("ChildBoardBlock.card").filter({ hasText: "タップで開くページ" });
    const childId = (await card.getAttribute("data-id"))!;

    // The empty line after the board (the body's middle is the board).
    await editorBody(page).locator('[data-content-type="paragraph"]').last().click();
    await page.keyboard.type("/child");
    await page.getByRole("option", { name: /子ページ一覧/ }).click();
    const link = page.locator(`[data-ui="ChildPagesBlock.link"][data-id="${childId}"]`);
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`/pages/${childId}$`));
    await expect(page.getByTestId("TitleField")).toHaveValue("タップで開くページ");

    // The board's card opens the same way.
    await openPage(page, parent.id);
    await card.getByTestId("ChildBoardBlock.cardLink").tap();
    await expect(page).toHaveURL(new RegExp(`/pages/${childId}$`));

    await openPage(page, parent.id);
    await trashOpenPage(page);
  });
});
