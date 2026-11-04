import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

test("links in the text are bold and carry a link icon", async ({ page }) => {
  await createPage(page, "E2E リンクの見た目");
  await typeInBody(page, "詳しくは ");
  // A link pasted from a web page (HTML), into the line.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", '<a href="https://example.com/docs">資料</a>');
    data.setData("text/plain", "資料");
    document.querySelector(".bn-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const link = editorBody(page).locator('.bn-inline-content a[href="https://example.com/docs"]');
  await expect(link).toBeVisible();
  const look = await link.evaluate((el) => ({
    weight: Number(getComputedStyle(el).fontWeight),
    underline: getComputedStyle(el).textDecorationLine,
    icon: getComputedStyle(el, "::after").maskImage || getComputedStyle(el, "::after").webkitMaskImage,
  }));
  expect(look.weight).toBeGreaterThanOrEqual(600);
  expect(look.underline).toContain("underline");
  expect(look.icon).toContain("svg");
  await trashOpenPage(page);
});
