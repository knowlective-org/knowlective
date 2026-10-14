import { expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

test.use({ storageState: authFile("editor") });

// Adds a page under the open one through the sidebar and returns its id.
async function addChild(page: import("@playwright/test").Page, parentId: string, title: string) {
  await page.locator(`[data-ui="DocTree.link"][data-id="${parentId}"]`).hover();
  await page.locator(`[data-ui="DocTree.addChildButton"][data-id="${parentId}"]`).click();
  await page.waitForURL((url) => /\/pages\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith(`/${parentId}`));
  await expect(editorBody(page)).toBeVisible();
  await page.getByTestId("TitleField").fill(title);
  return new URL(page.url()).pathname.split("/").pop()!;
}

const crumbs = (page: import("@playwright/test").Page) =>
  page.locator('[data-ui="Breadcrumb"] li');

test.describe("パンくずリスト", () => {
  test("3階層までは全部、4階層以上はナレッジルート・…・親・ページを表示する", async ({ page }) => {
    // E2E / E2E ホーム / A
    const a = await createPage(page, "E2E パンくず A");
    await expect(crumbs(page)).toHaveCount(3);
    await expect(crumbs(page).nth(0)).toHaveText(/E2E\s*\//);
    await expect(crumbs(page).nth(1)).toContainText("E2E ホーム");
    await expect(page.getByTestId("Breadcrumb.current")).toHaveText(a.title);
    await expect(page.getByTestId("Breadcrumb.expandButton")).toHaveCount(0);

    // E2E / E2E ホーム / A / B / C → E2E / … / B / C
    const b = await addChild(page, a.id, "パンくず B");
    await expect(crumbs(page)).toHaveCount(4);
    await expect(page.getByTestId("Breadcrumb.expandButton")).toBeVisible();
    // The steps above the open page show the titles stored on the server,
    // which the collaboration server writes a moment after typing (the open
    // page's own title is live). Give B's title time to get there.
    await page.waitForTimeout(3000);
    const c = await addChild(page, b, "パンくず C");
    await expect(page.getByTestId("Breadcrumb.current")).toHaveText("パンくず C");
    await expect(crumbs(page)).toHaveCount(4);
    await expect(crumbs(page).nth(0)).toContainText("E2E");
    await expect(page.getByTestId("Breadcrumb.expandButton")).toHaveAttribute("title", `E2E ホーム / ${a.title}`);
    await expect(page.locator(`[data-ui="Breadcrumb.link"][data-id="${b}"]`)).toHaveText("パンくず B");

    // "…" shows the whole path.
    await page.getByTestId("Breadcrumb.expandButton").click();
    await expect(crumbs(page)).toHaveCount(5);
    await expect(page.locator(`[data-ui="Breadcrumb.link"][data-id="${HOME_PAGE_ID}"]`)).toBeVisible();

    // A step leads to that page.
    await page.locator(`[data-ui="Breadcrumb.link"][data-id="${a.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/pages/${a.id}$`));
    await expect(page.getByTestId("Breadcrumb.current")).toHaveText(a.title);
    expect(c).not.toBe(b);
    await trashOpenPage(page);
  });

  test("閲覧のみの人にも、見られるページの道筋が出る", async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile("viewer") });
    const page = await context.newPage();
    try {
      await openPage(page, HOME_PAGE_ID);
      await expect(crumbs(page)).toHaveCount(2);
      await expect(page.getByTestId("Breadcrumb.current")).toHaveText("E2E ホーム");
    } finally {
      await context.close();
    }
  });
});