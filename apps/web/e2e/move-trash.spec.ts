import { expect, test } from "@playwright/test";
import { createKnowledgeRoot } from "shared";
import { ACCOUNTS, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";

test.use({ storageState: authFile("editor") });

// Moving a page takes the pages under it along, those in the trash too: so
// every one of them needs Edit, as the live ones do (lib/page-move.ts).
test("a page moves only if every page under it, in the trash too, can be edited", async ({ page }) => {
  const stamp = Date.now();
  const hidden = `E2E ごみ箱の子 ${stamp}`;
  const ids = await withPrisma(async (prisma) => {
    const editor = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
    const editors = await prisma.group.findFirstOrThrow({ where: { name: "E2E 編集" }, select: { id: true } });
    const other = await prisma.group.create({ data: { name: `E2E 移動先 ${stamp}`, members: { create: { userId: editor.id } } }, select: { id: true } });
    return prisma.$transaction(async (tx) => {
      const root = await createKnowledgeRoot(tx, { title: `E2E 移動 ${stamp}`, createdById: editor.id });
      const moved = await tx.page.create({ data: { title: `E2E 移動するページ ${stamp}`, rootId: root.rootId, parentId: root.rootPageId, createdById: editor.id } });
      const trashed = await tx.page.create({ data: { title: hidden, rootId: root.rootId, parentId: moved.id, createdById: editor.id, deletedAt: new Date() } });
      const target = await tx.page.create({ data: { title: `E2E 移動先 ${stamp}`, rootId: root.rootId, parentId: root.rootPageId, createdById: editor.id } });
      await tx.pageGrant.createMany({
        data: [
          { pageId: root.rootPageId, groupId: editors.id, access: "EDIT" },
          // The page in the trash: taken away from the editors.
          { pageId: trashed.id, groupId: editors.id, access: "NONE" },
          // The destination: Edit through another group too.
          { pageId: target.id, groupId: other.id, access: "EDIT" },
        ],
      });
      return { rootId: root.rootId, moved: moved.id, target: target.id, group: other.id };
    });
  });
  try {
    await page.goto(`pages/${ids.moved}`);
    await page.getByTestId("PageMenu.button").click();
    await page.getByTestId("PageMenu.move").click();
    await page.getByTestId("MoveDialog.parentSelect").selectOption(ids.target);
    await page.getByTestId("MoveDialog.submitButton").click();
    await expect(page.getByTestId("AppDialog")).toContainText("ごみ箱にあるもの");
    expect(await withPrisma((prisma) => prisma.page.findUnique({ where: { id: ids.moved }, select: { parentId: true } }).then((p) => p?.parentId))).not.toBe(ids.target);
    await page.goto("trash");
    await expect(page.getByTestId("TrashPage")).not.toContainText(hidden);
  } finally {
    await withPrisma(async (prisma) => {
      await prisma.knowledgeRoot.update({ where: { id: ids.rootId }, data: { deletedAt: new Date() } });
      await prisma.group.delete({ where: { id: ids.group } });
    });
  }
});
