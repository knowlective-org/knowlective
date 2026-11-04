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
