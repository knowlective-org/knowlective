import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

// BlockNote puts an empty toggle's placeholder after the whole toggle; open,
// that was the middle of the line (globals.css moves it to the title).
test("an empty toggle's placeholder stays where its title goes, open or not", async ({ page }) => {
  await createPage(page, "E2E トグル");
  await typeInBody(page, "/折りたたみリスト");
  await page.getByRole("option").first().click();
  await page.locator(".bn-toggle-button").click();
  await page.locator(".bn-toggle-wrapper .bn-inline-content").click();
  const offset = await editorBody(page)
    .locator('.bn-block-content:has(> div > .bn-toggle-wrapper)')
    .evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      const button = el.querySelector(".bn-toggle-button")!.getBoundingClientRect();
      return { content: after.content, left: parseFloat(after.left), button: button.right - el.getBoundingClientRect().left };
    });
  expect(offset.content).toContain("トグル");
  // Right after the button, not further along the line.
  expect(Math.abs(offset.left - offset.button)).toBeLessThan(8);
  await trashOpenPage(page);
});

// Puts the cursor at the end of a line of text.
// Waits for the cursor to be there: right after closing a toggle, a click can
// leave it in the (now hidden) blocks inside for a moment.
async function clickEnd(line: import("@playwright/test").Locator) {
  const box = (await line.boundingBox())!;
  const text = (await line.textContent()) ?? "";
  await expect(async () => {
    await line.click({ position: { x: box.width - 2, y: box.height / 2 } });
    await line.page().keyboard.press("End");
    const at = await line.page().evaluate(() => {
      const s = window.getSelection();
      const n = s?.anchorNode;
      return [(n instanceof Element ? n : n?.parentElement)?.closest(".bn-inline-content")?.textContent, s?.anchorOffset];
    });
    expect(at).toEqual([text, text.length]);
  }).toPass();
  // The editor reads the moved cursor a moment after the browser does: an
  // Enter right away (on a slow machine) went to the block typed in before.
  // Waiting for the edits to be saved gives it that moment.
  await expect(line.page().getByTestId("PageView.status")).toHaveCount(0);
}

// BlockNote's Enter split the toggle, and its blocks went with the new one
// below it (toggle-enter.ts keeps them).
test("Enter in a toggle's title keeps the blocks inside it", async ({ page }) => {
  await createPage(page, "E2E トグルの Enter");
  await typeInBody(page, "/折りたたみリスト");
  await page.getByRole("option").first().click();
  await page.keyboard.type("見出しの行");
  await page.locator(".bn-toggle-button").click();
  await page.locator(".bn-toggle-add-block-button").click();
  await page.keyboard.type("中の段落");
  const toggle = editorBody(page).locator('.bn-block-outer:has(> .bn-block > .bn-block-content[data-content-type="toggleListItem"])');
  await expect(toggle.locator(".bn-block-group")).toContainText("中の段落");

  // Open: the text after the cursor becomes the first block inside.
  await clickEnd(toggle.locator('[data-content-type="toggleListItem"] .bn-inline-content').first());
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("新しい先頭");
  const inside = toggle.locator(".bn-block-group .bn-block-content");
  await expect(inside).toHaveCount(2);
  await expect(inside.nth(0)).toHaveText("新しい先頭");
  await expect(inside.nth(1)).toHaveText("中の段落");
  await expect(editorBody(page).locator('[data-content-type="toggleListItem"]')).toHaveCount(1);

  // Closed: a new toggle below; the blocks stay in this one.
  await expect(async () => {
    await page.locator(".bn-toggle-button").first().click();
    await expect(toggle.locator(".bn-block-group").first()).toBeHidden({ timeout: 2000 });
  }).toPass();
  await clickEnd(toggle.locator('[data-content-type="toggleListItem"] .bn-inline-content').first());
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("次のトグル");
  await expect(editorBody(page).locator('[data-content-type="toggleListItem"]')).toHaveCount(2);
  await expect(toggle.first().locator(".bn-block-group .bn-block-content")).toHaveCount(2);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});

test("Enter in a toggle heading's title keeps the blocks inside it too", async ({ page }) => {
  await createPage(page, "E2E 折りたたみ見出しの Enter");
  await typeInBody(page, "/折りたたみ見出し");
  await page.getByRole("option", { name: /折りたたみ見出し/ }).first().click();
  await page.keyboard.type("見出し");
  await page.locator(".bn-toggle-button").click();
  await page.locator(".bn-toggle-add-block-button").click();
  await page.keyboard.type("中の段落");
  const heading = editorBody(page).locator('.bn-block-outer:has(> .bn-block > .bn-block-content[data-content-type="heading"])');
  await clickEnd(heading.locator('[data-content-type="heading"] .bn-inline-content').first());
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("先頭");
  const inside = heading.locator(".bn-block-group .bn-block-content");
  await expect(inside).toHaveCount(2);
  await expect(inside.nth(1)).toHaveText("中の段落");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});
