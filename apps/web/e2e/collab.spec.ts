import { expect, test } from "@playwright/test";
import { ACCOUNTS, authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

test.describe("Collaborative editing", () => {
  test("what one person types shows up on the other's screen at once", async ({ browser }) => {
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

  test("another person's cursor: a badge in their avatar color, with their avatar and name in a shade that reads on it", async ({ browser }) => {
    const editorId = await withPrisma((prisma) =>
      prisma.user.findFirstOrThrow({ where: { name: ACCOUNTS.editor.name }, select: { id: true } }).then((u) => u.id),
    );
    const setColor = (avatarColor: string | null) => withPrisma((prisma) => prisma.user.update({ where: { id: editorId }, data: { avatarColor } }));
    await setColor("#1f5f8b");
    const editorContext = await browser.newContext({ storageState: authFile("editor") });
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const editor = await editorContext.newPage();
    const admin = await adminContext.newPage();
    try {
      const { id } = await createPage(editor, "E2E カーソルの色");
      await openPage(admin, id);
      await typeInBody(editor, "ここにいます");
      await expect(editorBody(admin)).toContainText("ここにいます");
      const label = admin.locator(".bn-collaboration-cursor__label").filter({ hasText: ACCOUNTS.editor.name });
      await expect(label).toBeVisible();
      // Dark blue: a very light blue text.
      await expect(label).toHaveCSS("background-color", "rgb(31, 95, 139)");
      await expect(label).toHaveCSS("color", "rgb(242, 248, 252)");
      await expect(label.locator(`[data-ui="Avatar"][data-id="${editorId}"]`)).toHaveCount(1);
      await trashOpenPage(editor);
    } finally {
      await setColor(null);
      await editorContext.close();
      await adminContext.close();
    }
  });
});