import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

test.describe("共同編集", () => {
  test("片方が入力すると、もう片方の画面にすぐ出る", async ({ browser }) => {
    const editorContext = await browser.newContext({ storageState: authFile("editor") });
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const editor = await editorContext.newPage();
    const admin = await adminContext.newPage();
    try {
      const { id, title } = await createPage(editor, "E2E 共同編集");
      await openPage(admin, id);
      await expect(admin.getByTestId("TitleField")).toHaveValue(title);

      await typeInBody(editor, "編集者が書きました");
      await expect(editorBody(admin)).toContainText("編集者が書きました");

      await typeInBody(admin, "管理者が書きました");
      await expect(editorBody(editor)).toContainText("管理者が書きました");

      await trashOpenPage(editor);
    } finally {
      await editorContext.close();
      await adminContext.close();
    }
  });
});