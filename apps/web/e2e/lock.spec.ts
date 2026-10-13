import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

test.use({ storageState: authFile("editor") });

async function lock(page: import("@playwright/test").Page, scope: "page" | "subtree") {
  await page.getByTestId("PageMenu.button").click();
  await page.getByTestId("PageMenu.lock").click();
  await page.locator(`[data-ui="AppDialog.choiceButton"][data-id="${scope}"]`).click();
  await expect(page.getByTestId("PageView.lockBanner")).toBeVisible();
}

async function unlock(page: import("@playwright/test").Page) {
  await page.getByTestId("PageMenu.button").click();
  await page.getByTestId("PageMenu.unlock").click();
  const confirm = page.getByTestId("AppDialog.confirmButton");
  // Nothing happens until the code shown in the dialog is typed back.
  await expect(confirm).toBeDisabled();
  await page.getByTestId("AppDialog.codeInput").fill("wrong1");
  await expect(confirm).toBeDisabled();
  const code = (await page.getByTestId("AppDialog.code").textContent())!.trim();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
  // Lower case is accepted.
  await page.getByTestId("AppDialog.codeInput").fill(code.toLowerCase());
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId("PageView.lockBanner")).toHaveCount(0);
}

test.describe("ページのロック", () => {
  test("ロックすると編集できなくなり、確認の文字を入力すると解除できる", async ({ page }) => {
    const { id } = await createPage(page, "E2E ロック");
    await typeInBody(page, "ロック前の本文");
    await lock(page, "page");

    await expect(page.getByTestId("PageView.lockStatus")).toBeVisible();
    await expect(editorBody(page)).toHaveAttribute("contenteditable", "false");
    await expect(page.getByTestId("TitleField")).toHaveAttribute("readonly", "");
    await expect(page.locator(`[data-ui="DocTree.lockStatus"][data-id="${id}"]`)).toBeVisible();
    // The server refuses too, not only the screen: a file can't be added.
    const upload = await page.request.post(`api/files?pageId=${id}`, {
      multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") } },
    });
    expect(upload.status()).toBe(423);
    // Moving and deleting are off while locked.
    await page.getByTestId("PageMenu.button").click();
    await expect(page.getByTestId("PageMenu.delete")).toHaveCount(0);
    await expect(page.getByTestId("PageMenu.move")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // A lock on the page alone still lets child pages be added under it.
    await expect(page.locator(`[data-ui="DocTree.addChildButton"][data-id="${id}"]`)).toHaveCount(1);

    // Still locked after a reload (the lock is the server's).
    await page.reload();
    await expect(editorBody(page)).toContainText("ロック前の本文");
    await expect(editorBody(page)).toHaveAttribute("contenteditable", "false");

    await unlock(page);
    await expect(editorBody(page)).toHaveAttribute("contenteditable", "true");
    await typeInBody(page, "解除後に追記");
    await expect(editorBody(page)).toContainText("解除後に追記");
    await trashOpenPage(page);
  });

  test("子ページも含めてロックすると、子ページも編集できず、解除は親でする", async ({ page }) => {
    const parent = await createPage(page, "E2E ロック 親");
    // A child page under it.
    await page.locator(`[data-ui="DocTree.link"][data-id="${parent.id}"]`).hover();
    await page.locator(`[data-ui="DocTree.addChildButton"][data-id="${parent.id}"]`).click();
    await page.waitForURL((url) => !url.pathname.endsWith(parent.id) && /\/pages\/[^/]+$/.test(url.pathname));
    await expect(editorBody(page)).toBeVisible();
    const childId = new URL(page.url()).pathname.split("/").pop()!;

    await openPage(page, parent.id);
    await lock(page, "subtree");
    // No more pages under it.
    await expect(page.locator(`[data-ui="DocTree.addChildButton"][data-id="${parent.id}"]`)).toHaveCount(0);

    await openPage(page, childId);
    await expect(page.getByTestId("PageView.lockBanner")).toContainText("上位のページ");
    await expect(page.getByTestId("PageView.lockHolderLink")).toHaveAttribute("href", new RegExp(`/pages/${parent.id}$`));
    await expect(editorBody(page)).toHaveAttribute("contenteditable", "false");
    // It can't be unlocked from the child.
    await page.getByTestId("PageMenu.button").click();
    await expect(page.getByTestId("PageMenu.unlock")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await openPage(page, parent.id);
    await unlock(page);
    await openPage(page, childId);
    await expect(editorBody(page)).toHaveAttribute("contenteditable", "true");

    await openPage(page, parent.id);
    await trashOpenPage(page);
  });

  test("ほかの人が開いている画面も、ロックした時点で編集できなくなる", async ({ page, browser }) => {
    const { id } = await createPage(page, "E2E ロック 同時");
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const admin = await adminContext.newPage();
    try {
      await openPage(admin, id);
      await expect(editorBody(admin)).toHaveAttribute("contenteditable", "true");
      await lock(page, "page");
      await expect(admin.getByTestId("PageView.lockBanner")).toBeVisible();
      await expect(editorBody(admin)).toHaveAttribute("contenteditable", "false");
      // Anyone with edit access may unlock, not only the person who locked.
      await unlock(admin);
      await expect(page.getByTestId("PageView.lockBanner")).toHaveCount(0);
      await expect(editorBody(page)).toHaveAttribute("contenteditable", "true");
    } finally {
      await adminContext.close();
    }
    await trashOpenPage(page);
  });
});