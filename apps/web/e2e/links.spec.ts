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

test("a link to this site opens in the same tab; one to another site in a new tab", async ({ page, context }) => {
  const target = await createPage(page, "E2E リンク先");
  const { id } = await createPage(page, "E2E 同じタブのリンク");
  await typeInBody(page, "移動 ");
  const href = page.url().replace(/pages\/[^/?#]+.*$/, `pages/${target.id}`);
  await page.evaluate((h) => {
    const data = new DataTransfer();
    data.setData("text/html", `<a href="${h}">リンク先へ</a> <a href="https://example.com/x">外部</a>`);
    data.setData("text/plain", "リンク先へ 外部");
    document.querySelector(".bn-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, href);
  const internal = editorBody(page).locator(".bn-inline-content a", { hasText: "リンク先へ" });
  await expect(internal).toBeVisible();

  // Another site: a new tab, this one stays.
  const popup = context.waitForEvent("page");
  await editorBody(page).locator(".bn-inline-content a", { hasText: "外部" }).click();
  await (await popup).close();
  expect(page.url()).toContain(id);

  // This site: here.
  const pages = context.pages().length;
  await internal.click();
  await page.waitForURL(new RegExp(`pages/${target.id}`));
  expect(context.pages().length).toBe(pages);
  await trashOpenPage(page);
  await page.goto(`pages/${id}`);
  await trashOpenPage(page);
});
