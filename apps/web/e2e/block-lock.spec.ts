import { type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

// Block locks from the ⋮⋮ menu: against deleting the block, or also against
// changing its content. Kept in the page's document, so everyone with the
// page open (and after a reload) has them.
test.use({ storageState: authFile("editor") });

const block = (page: Page, text: string) => editorBody(page).locator(".bn-block-content", { hasText: text });
const outer = (page: Page, text: string) =>
  editorBody(page).locator(".bn-block-outer", { has: page.locator(".bn-block-content", { hasText: text }) }).last();

async function openMenu(page: Page, text: string) {
  await block(page, text).hover();
  await page.locator(".bn-side-menu [draggable=true]").click();
}

async function lock(page: Page, text: string, item: "lockNoneItem" | "lockDeleteItem" | "lockEditItem") {
  await openMenu(page, text);
  await page.getByTestId("BlockMenu.lockItem").hover();
  await page.getByTestId(`BlockMenu.${item}`).click();
}

test.describe("Block locks", () => {
  test("a block locked against deleting stays, one locked against changes stays as it is", async ({ page, context }) => {
    const { id } = await createPage(page, "E2E ブロックのロック");
    await typeInBody(page, "削除しない段落");
    await page.keyboard.press("Enter");
    await page.keyboard.type("変更しない段落");
    await page.keyboard.press("Enter");
    await page.keyboard.type("普通の段落");

    await lock(page, "削除しない段落", "lockDeleteItem");
    await expect(outer(page, "削除しない段落")).toHaveAttribute("data-lock", "delete");
    await lock(page, "変更しない段落", "lockEditItem");
    await expect(outer(page, "変更しない段落")).toHaveAttribute("data-lock", "edit");
    await expect(outer(page, "変更しない段落")).toHaveAttribute("contenteditable", "false");

    // Deleting from the menu is refused, with a notice.
    await openMenu(page, "削除しない段落");
    await page.getByRole("menuitem", { name: "削除", exact: true }).click();
    await expect(page.getByTestId("Notice")).toContainText("ロックしたブロックは削除できません");
    await expect(block(page, "削除しない段落")).toBeVisible();
    // Its content can still change.
    await block(page, "削除しない段落").click();
    await page.keyboard.press("End");
    await page.keyboard.type("（追記）");
    await expect(block(page, "削除しない段落")).toHaveText("削除しない段落（追記）");
    // Delete at its end would merge the locked-against-changes block into it.
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("Notice")).toContainText("内容を変更できません");
    await expect(block(page, "変更しない段落")).toHaveText("変更しない段落");
    // Everything selected and deleted: refused whole.
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await expect(block(page, "普通の段落")).toBeVisible();
    await expect(block(page, "変更しない段落")).toBeVisible();
    // The menu acts on the selected blocks: select none.
    await block(page, "普通の段落").click();
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    // Another screen with the page open has the locks; so does a reload.
    const other = await context.newPage();
    await openPage(other, id);
    await expect(outer(other, "削除しない段落（追記）")).toHaveAttribute("data-lock", "delete");
    await expect(outer(other, "変更しない段落")).toHaveAttribute("data-lock", "edit");
    await other.close();

    // Loosening asks first; then the block can be deleted.
    await lock(page, "削除しない段落（追記）", "lockNoneItem");
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(editorBody(page).locator('.kn-block-locked[data-lock="delete"]')).toHaveCount(0);
    await openMenu(page, "削除しない段落（追記）");
    await page.getByRole("menuitem", { name: "削除", exact: true }).click();
    await expect(block(page, "削除しない段落（追記）")).toHaveCount(0);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);

    await page.reload();
    await expect(outer(page, "変更しない段落")).toHaveAttribute("data-lock", "edit");
    await expect(block(page, "削除しない段落（追記）")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("a screen from before the app's current version is asked to reload, and can't edit", async ({ page }) => {
    const { id } = await createPage(page, "E2E 古い画面");
    // The token request as an editor of an older version sends it: without
    // the version (the Server Action's arguments are JSON).
    await page.route(`**/pages/${id}`, async (route) => {
      const request = route.request();
      const body = request.postData();
      if (request.method() !== "POST" || !request.headers()["next-action"] || !body?.startsWith(`["${id}",`)) {
        return route.fallback();
      }
      await route.continue({ postData: JSON.stringify([id]) });
    });
    await page.reload();
    await expect(page.getByTestId("EditorPlaceholder")).toContainText("アプリが更新されました");
    await expect(editorBody(page)).toHaveCount(0);
    await page.unroute(`**/pages/${id}`);
    await page.getByTestId("EditorPlaceholder.reloadButton").click();
    await expect(editorBody(page)).toBeVisible();
    await trashOpenPage(page);
  });
});
