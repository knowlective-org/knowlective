import { type Page, expect, test } from "@playwright/test";
import { createKnowledgeRoot } from "shared";
import { ACCOUNTS, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { userWhere, withPrisma } from "./db";

// Knowledge roots in the admin console (/admin/roots): a site admin sees
// every one (its name) and can delete and restore it, but can't open one
// without a grant, nor read its pages' titles in the change log.

// Accepts the dialog that asks for the shown code to be typed back.
async function typeConfirm(page: Page) {
  const code = (await page.getByTestId("AppDialog.code").textContent())!.trim();
  await page.getByTestId("AppDialog.codeInput").fill(code);
  await page.getByTestId("AppDialog.confirmButton").click();
}

test("site admins see every knowledge root and can delete and restore one, without seeing inside it", async ({ browser }) => {
  const title = `E2E 管理者が開けないルート ${Date.now()}`;
  // A root only the editors' group can open (the admin isn't in it).
  const { rootId, rootPageId } = await withPrisma(async (prisma) => {
    const group = await prisma.group.findFirstOrThrow({ where: { name: "E2E 編集" }, select: { id: true } });
    const editor = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
    return prisma.$transaction(async (tx) => {
      const root = await createKnowledgeRoot(tx, { title, createdById: editor.id });
      await tx.pageGrant.create({ data: { pageId: root.rootPageId, groupId: group.id, access: "MANAGE" } });
      return root;
    });
  });
  const editorContext = await browser.newContext({ storageState: authFile("editor") });
  const adminContext = await browser.newContext({ storageState: authFile("admin") });
  const editor = await editorContext.newPage();
  const admin = await adminContext.newPage();
  try {
    // The editor locks its page: the change log names it.
    await editor.goto(`pages/${rootPageId}`);
    await expect(editor.getByTestId("TitleField")).toHaveValue(title);
    await editor.getByTestId("PageMenu.button").click();
    await editor.getByTestId("PageMenu.lock").click();
    await editor.locator('[data-ui="AppDialog.choiceButton"][data-id="page"]').click();
    await expect(editor.getByTestId("PageView.lockBanner")).toBeVisible();

    // The admin can't open it…
    expect((await admin.goto(`pages/${rootPageId}`))?.status()).toBe(404);
    // …nor read its title in the change log.
    await openAdmin(admin, "/security");
    const entry = admin.getByTestId("AdminSecurityPage.auditLogRow").first();
    await expect(entry).toContainText("ページ「閲覧できないページ」をロック");
    await expect(admin.getByTestId("AdminSecurityPage.auditSection")).not.toContainText(title);

    // But sees the root, by its name, with the group that has access.
    await openAdmin(admin, "/roots");
    const row = admin.getByTestId("AdminRootsPage.rootRow").filter({ hasText: title });
    await expect(row).toContainText("E2E 編集（管理）");

    // Deleted: nobody can open it, its editors included.
    await row.getByTestId("DeleteRootButton.submitButton").click();
    await typeConfirm(admin);
    const deleted = admin.getByTestId("AdminRootsPage.deletedSection").getByTestId("AdminRootsPage.rootRow").filter({ hasText: title });
    await expect(deleted).toBeVisible();
    await expect.poll(async () => (await editor.goto(`pages/${rootPageId}`))?.status()).toBe(404);
    await expect(editor.getByTestId("DocTree.link").filter({ hasText: title })).toHaveCount(0);

    // Restored: as it was.
    await deleted.getByTestId("RestoreRootButton.submitButton").click();
    await admin.getByTestId("AppDialog.confirmButton").click();
    await expect(deleted).toHaveCount(0);
    await expect(row).toBeVisible();
    expect((await editor.goto(`pages/${rootPageId}`))?.status()).toBe(200);
    await expect(editor.getByTestId("TitleField")).toHaveValue(title);
    await expect(editor.getByTestId("PageView.lockBanner")).toBeVisible();

    // The delete action, posted directly by someone who isn't a site admin
    // (the editor, logged in to the app only): nothing happens.
    await admin.goto("admin/roots");
    const action = (await row.locator('input[name^="$ACTION_ID_"]').first().getAttribute("name"))!;
    const origin = new URL(admin.url()).origin;
    await editorContext.request.post("admin/roots", { headers: { Origin: origin }, multipart: { [action]: "", rootId }, maxRedirects: 0 });
    expect(await withPrisma((prisma) => prisma.knowledgeRoot.findUnique({ where: { id: rootId }, select: { deletedAt: true } }))).toEqual({ deletedAt: null });
  } finally {
    // Out of the way: deleted (it can't be removed).
    await withPrisma((prisma) => prisma.knowledgeRoot.update({ where: { id: rootId }, data: { deletedAt: new Date() } }));
    await editorContext.close();
    await adminContext.close();
  }
});
