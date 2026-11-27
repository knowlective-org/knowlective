import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

// The table of contents block: the page's headings, following them as they
// change, each scrolling to its heading.
test.use({ storageState: authFile("editor") });

test("a table of contents lists the headings, follows them, and jumps to them", async ({ page }) => {
  await createPage(page, "E2E 目次");
  await typeInBody(page, "/目次");
  await page.getByRole("option", { name: /目次/ }).first().click();
  const toc = page.getByTestId("TocBlock");
  await expect(toc.getByTestId("TocBlock.empty")).toBeVisible();

  // Headings below it, with a long body between them.
  await page.keyboard.press("Control+End");
  await page.keyboard.type("## はじめに");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.type(`本文 ${i}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("### 詳しく");
  await page.keyboard.press("Enter");
  const links = toc.getByTestId("TocBlock.headingLink");
  await expect(links).toHaveText(["はじめに", "詳しく"]);
  await expect(links.nth(1)).toHaveAttribute("data-level", "3");

  // A heading's text changed: so is the list.
  await editorBody(page).locator("h2", { hasText: "はじめに" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("と背景");
  await expect(links.first()).toHaveText("はじめにと背景");

  // A click scrolls to the heading (the address stays the page's).
  const target = editorBody(page).locator("h3", { hasText: "詳しく" });
  await toc.scrollIntoViewIfNeeded();
  await expect(target).not.toBeInViewport();
  const url = page.url();
  await links.nth(1).click();
  await expect(target).toBeInViewport();
  expect(page.url()).toBe(url);
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await trashOpenPage(page);
});

test("a document page shows its headings on the right on a wide screen, not when printed", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await createPage(page, "E2E 右の目次");
  const toc = page.getByTestId("PageToc");
  // No heading: no table of contents.
  await typeInBody(page, "本文");
  await expect(toc).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.keyboard.type("## 最初");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.type(`本文 ${i}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("### 次");
  await page.keyboard.press("Enter");
  const links = toc.getByTestId("PageToc.headingLink");
  await expect(links).toHaveText(["最初", "次"]);
  await expect(toc).toBeVisible();

  // A click scrolls to the heading, and marks it as the one being read.
  await page.mouse.wheel(0, -10000);
  const target = editorBody(page).locator("h3", { hasText: "次" });
  await expect(target).not.toBeInViewport();
  await links.nth(1).click();
  await expect(target).toBeInViewport();
  await expect(links.nth(1)).toHaveAttribute("aria-current", "location");

  // Narrow screens and print: not shown.
  await page.emulateMedia({ media: "print" });
  await expect(toc).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(toc).toBeHidden();
  await page.setViewportSize({ width: 1400, height: 900 });
  await trashOpenPage(page);
});
