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
