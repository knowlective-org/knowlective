import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test("a click on a file path in the text copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createPage(page, "E2E ファイルのパス");
  await typeInBody(page, String.raw`保存先は \\fileserver\share\資料 です`);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);

  // Click in the middle of the path (the text around it doesn't copy).
  const paragraph = editorBody(page).locator('[data-content-type="paragraph"]').filter({ hasText: "fileserver" });
  const box = await paragraph.evaluate((el) => {
    const text = el.querySelector(".bn-inline-content")!.firstChild as Text;
    const start = text.data.indexOf("share");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 5);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await expect(page.getByTestId("Notice")).toContainText("パスをコピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(String.raw`\\fileserver\share\資料`);
  await trashOpenPage(page);
});
