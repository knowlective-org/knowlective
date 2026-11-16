import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// Typing into the editor: a date typed as digits, and a URL pasted into text
// that reads as its page's title.
test.use({ storageState: authFile("editor") });

// Pastes `text` where the caret is.
async function pasteHere(page: Page, text: string) {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    document.querySelector(".bn-editor")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test("a date typed as digits (20261116) is that date", async ({ page }) => {
  await createPage(page, "E2E 日付の入力");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("[ ] 期限のあるTODO");
  const due = page.getByTestId("TodoBlock.dueInput");
  // The fields' order is the browser's (year first in Japanese, month first
  // on some machines, e.g. CI's Linux). The year taking more than 4 digits
  // matters only when it comes first.
  await due.click({ position: { x: 6, y: 6 } });
  await page.keyboard.type("11162026");
  if ((await due.inputValue()) !== "2026-11-16") {
    await due.fill("");
    await due.click({ position: { x: 6, y: 6 } });
    await page.keyboard.type("20261116");
  }
  await expect(due).toHaveValue("2026-11-16");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});

test("a URL of a page pasted into text reads as that page's title", async ({ page }) => {
  const target = await createPage(page, "E2E リンク先のページ");
  const targetUrl = page.url();
  await createPage(page, "E2E タイトルのリンク");
  await editorBody(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("参照: ");
  await pasteHere(page, targetUrl);
  const link = editorBody(page).locator(`a[href="${targetUrl}"]`);
  await expect(link).toHaveText(target.title);
  await expect(editorBody(page).locator('[data-content-type="paragraph"]').first()).toHaveText(`参照: ${target.title}`);
  // Text selected: the URL links it, as before (the text stays).
  await page.keyboard.press("Enter");
  await page.keyboard.type("ここ");
  await page.keyboard.press("Shift+Home");
  // (Selected in the editor before the paste: on a busy machine the key's
  // selection comes a moment later. The formatting toolbar shows it has.)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("ここ");
  await expect(page.locator(".bn-formatting-toolbar")).toBeVisible();
  await pasteHere(page, targetUrl);
  await expect(editorBody(page).locator(`a[href="${targetUrl}"]`).filter({ hasText: "ここ" })).toHaveCount(1);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
