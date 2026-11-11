import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

const paragraphs = (page: Page) => editorBody(page).locator('[data-content-type="paragraph"]');

// Drags the block with the text by its ⋮⋮ handle to below the last block,
// outside the text (where BlockNote passes the drop on as an event of its own).
async function dragBelowLast(page: Page, text: string, copy: boolean) {
  await editorBody(page).locator(".bn-block-content", { hasText: text }).hover();
  const handle = page.locator(".bn-side-menu [draggable=true]");
  const from = (await handle.boundingBox())!;
  const body = (await editorBody(page).boundingBox())!;
  if (copy) await page.keyboard.down("Control");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 5 });
  await page.mouse.move(body.x + body.width / 2, body.y + body.height + 60, { steps: 15 });
  await page.mouse.up();
  if (copy) await page.keyboard.up("Control");
}

test.describe("Dragging a block by its handle", () => {
  test("with Ctrl copies it, also when dropped below the last block", async ({ page }) => {
    await createPage(page, "E2E ブロックの複製");
    await typeInBody(page, "一つ目");
    await page.keyboard.press("Enter");
    await page.keyboard.type("二つ目");
    await expect(paragraphs(page).filter({ hasText: /\S/ })).toHaveText(["一つ目", "二つ目"]);

    await dragBelowLast(page, "一つ目", true);
    await expect(paragraphs(page).filter({ hasText: /\S/ })).toHaveText(["一つ目", "二つ目", "一つ目"]);

    // Without Ctrl, a move.
    await dragBelowLast(page, "二つ目", false);
    await expect(paragraphs(page).filter({ hasText: /\S/ })).toHaveText(["一つ目", "一つ目", "二つ目"]);

    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await trashOpenPage(page);
  });
});
