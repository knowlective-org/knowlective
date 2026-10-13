import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test.describe("ページ上部のバー", () => {
  test("入力すると「保存中」と出て、保存が終わると消える", async ({ page }) => {
    await createPage(page, "E2E 保存中");
    const status = page.getByTestId("PageView.status");
    // The title typed just now has been saved by the time nothing is pending.
    await expect(status).toHaveCount(0);
    await typeInBody(page, "保存の表示を確かめる文章");
    await expect(status).toHaveText("保存中…");
    await expect(status).toHaveCount(0);
    // What was typed did reach the server.
    await page.reload();
    await expect(editorBody(page)).toContainText("保存の表示を確かめる文章");
    await trashOpenPage(page);
  });

  test("長いページをスクロールしても、上に表示されたままになる", async ({ page }) => {
    await createPage(page, "E2E 上部固定");
    await editorBody(page).click();
    for (let i = 0; i < 45; i++) {
      await page.keyboard.type(`行 ${i + 1}`);
      await page.keyboard.press("Enter");
    }
    const toolbar = page.getByTestId("PageView.toolbar");
    const share = page.getByTestId("PageView.shareButton");
    const before = (await share.boundingBox())!;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    // Still in the window, at the same height, and usable.
    await expect(share).toBeInViewport();
    const after = (await share.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect((await toolbar.boundingBox())!.y).toBe(0);
    await page.getByTestId("PageMenu.button").click();
    await expect(page.getByTestId("PageMenu.panel")).toBeInViewport();
    await page.keyboard.press("Escape");
    // Everything typed has been saved in the end.
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await trashOpenPage(page);
  });
});