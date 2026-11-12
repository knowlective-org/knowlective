import { expect, test } from "@playwright/test";
import { createKnowledgeRoot } from "shared";
import { ACCOUNTS, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";

// Shortcuts (lib/shortcuts.ts) and the sidebar's short list of a page with
// many child pages (DocTree's MANY_CHILDREN, ChildListDialog).

// A knowledge root for the test: the editors can edit it, the viewers see it.
async function makeRoot(label: string, pages: { title: string }[]) {
  return withPrisma(async (prisma) => {
    const editor = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
    const [editors, viewers] = await Promise.all([
      prisma.group.findFirstOrThrow({ where: { name: "E2E 編集" }, select: { id: true } }),
      prisma.group.findFirstOrThrow({ where: { name: "E2E 閲覧" }, select: { id: true } }),
    ]);
    return prisma.$transaction(async (tx) => {
      const root = await createKnowledgeRoot(tx, { title: label, createdById: editor.id });
      await tx.pageGrant.createMany({
        data: [
          { pageId: root.rootPageId, groupId: editors.id, access: "EDIT" },
          { pageId: root.rootPageId, groupId: viewers.id, access: "VIEW" },
        ],
      });
      const ids: string[] = [];
      for (const [i, p] of pages.entries()) {
        const page = await tx.page.create({
          data: { title: p.title, rootId: root.rootId, parentId: root.rootPageId, createdById: editor.id, sortOrder: i },
          select: { id: true },
        });
        ids.push(page.id);
      }
      return { rootId: root.rootId, rootPageId: root.rootPageId, ids, viewers: viewers.id };
    });
  });
}

const deleteRoot = (rootId: string) =>
  withPrisma((prisma) => prisma.knowledgeRoot.update({ where: { id: rootId }, data: { deletedAt: new Date() } }));

test.describe("shortcuts", () => {
  test.use({ storageState: authFile("editor") });

  test("a shortcut opens its page; those who can't open the page see neither it nor its title", async ({ page, browser }) => {
    const stamp = Date.now();
    const root = await makeRoot(`E2E ショートカット ${stamp}`, [{ title: `E2E 参照先 ${stamp}` }, { title: `E2E 置き場所 ${stamp}` }]);
    const [target, place] = root.ids;
    // The viewers can't open the target.
    await withPrisma((prisma) => prisma.pageGrant.create({ data: { pageId: target, groupId: root.viewers, access: "NONE" } }));
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    try {
      // Created from the target's menu, with the move dialog's choice of place.
      await page.goto(`pages/${target}`);
      await page.getByTestId("PageMenu.button").click();
      await page.getByTestId("PageMenu.createShortcut").click();
      await expect(page.getByTestId("MoveDialog")).toHaveAttribute("data-purpose", "shortcut");
      await page.getByTestId("MoveDialog.filterInput").fill(`置き場所 ${stamp}`);
      await page.getByTestId("MoveDialog.parentSelect").selectOption(place);
      await page.getByTestId("MoveDialog.submitButton").click();
      await page.waitForURL(`**/pages/${place}`);

      // Under its place in the sidebar, with the target's title; it opens the target.
      const shortcut = page.getByTestId("DocTree.shortcutLink").filter({ hasText: `E2E 参照先 ${stamp}` });
      await expect(shortcut).toBeVisible();
      const shortcutId = (await shortcut.getAttribute("data-id"))!;
      expect(await withPrisma((prisma) => prisma.page.findUnique({ where: { id: shortcutId }, select: { kind: true, title: true, parentId: true } }))).toEqual({
        kind: "SHORTCUT",
        title: "",
        parentId: place,
      });
      await shortcut.click();
      await page.waitForURL(`**/pages/${target}`);
      // Its own address goes to the target too.
      await page.goto(`pages/${shortcutId}`);
      await page.waitForURL(`**/pages/${target}`);

      // A viewer sees a shortcut to a page they can't open: no title, no link,
      // and its address is "not found".
      const viewer = await viewerContext.newPage();
      await viewer.goto(`pages/${place}`);
      await expect(viewer.getByTestId("DocTree.unavailableShortcut")).toHaveAttribute("data-id", shortcutId);
      await expect(viewer.getByTestId("DocTree").filter({ hasText: `E2E ショートカット ${stamp}` })).not.toContainText(`E2E 参照先 ${stamp}`);
      expect((await viewer.goto(`pages/${shortcutId}`))?.status()).toBe(404);

      // Nothing goes under a shortcut.
      await page.goto(`pages/${place}`);
      await expect(page.getByTestId("AddPageMenu.toggleButton").and(page.locator(`[data-id="${shortcutId}"]`))).toHaveCount(0);

      // Removed (to the trash); the page itself stays.
      await page.getByTestId("DocTree.removeShortcutButton").and(page.locator(`[data-id="${shortcutId}"]`)).click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect(page.getByTestId("DocTree.shortcutLink")).toHaveCount(0);
      expect(await withPrisma((prisma) => prisma.page.findUnique({ where: { id: target }, select: { deletedAt: true } }))).toEqual({ deletedAt: null });
    } finally {
      await viewerContext.close();
      await deleteRoot(root.rootId);
    }
  });
});

test.describe("many child pages", () => {
  test.use({ storageState: authFile("editor") });

  test("the sidebar lists only the open one; the rest are in the list of child pages", async ({ page }) => {
    const stamp = Date.now();
    const root = await makeRoot(`E2E 子ページが多い ${stamp}`, [{ title: `E2E 親 ${stamp}` }]);
    const parentId = root.ids[0];
    const children = await withPrisma(async (prisma) => {
      const editor = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
      const ids: string[] = [];
      for (let i = 0; i < 31; i++) {
        const child = await prisma.page.create({
          data: { title: `E2E 子 ${String(i).padStart(2, "0")}`, rootId: root.rootId, parentId, createdById: editor.id, sortOrder: i },
          select: { id: true },
        });
        ids.push(child.id);
      }
      return ids;
    });
    try {
      // On a child page: only it among its 31 siblings, and how many others there are.
      await page.goto(`pages/${children[15]}`);
      const tree = page.getByTestId("DocTree").filter({ hasText: `E2E 子ページが多い ${stamp}` });
      await expect(tree.getByTestId("DocTree.link").filter({ hasText: "E2E 子 15" })).toBeVisible();
      await expect(tree.getByTestId("DocTree.link").filter({ hasText: /E2E 子 \d\d/ })).toHaveCount(1);
      await expect(tree.getByTestId("DocTree.moreButton")).toHaveText("ほか 30 ページ");

      // That row opens them all, filtered by title.
      await tree.getByTestId("DocTree.moreButton").click();
      const dialog = page.getByTestId("ChildListDialog");
      await expect(dialog.getByTestId("ChildListDialog.pageLink")).toHaveCount(31);
      await dialog.getByTestId("ChildListDialog.filterInput").fill("子 3");
      await expect(dialog.getByTestId("ChildListDialog.pageLink")).toHaveText(["E2E 子 30"]);
      await dialog.getByTestId("ChildListDialog.pageLink").filter({ hasText: "E2E 子 30" }).click();
      await page.waitForURL(`**/pages/${children[30]}`);
      await expect(page.getByTestId("ChildListDialog")).toHaveCount(0);

      // On the parent: none of them listed, only their number; the page menu has the list too.
      await page.goto(`pages/${parentId}`);
      await expect(tree.getByTestId("DocTree.moreButton")).toHaveText("31 ページ");
      await page.getByTestId("PageMenu.button").click();
      await page.getByTestId("PageMenu.childPages").click();
      await expect(page.getByTestId("ChildListDialog.pageLink")).toHaveCount(31);
      await page.getByTestId("ChildListDialog.closeButton").click();

      // A page with no child pages has no such menu item.
      await page.goto(`pages/${children[0]}`);
      await page.getByTestId("PageMenu.button").click();
      await expect(page.getByTestId("PageMenu.history")).toBeVisible();
      await expect(page.getByTestId("PageMenu.childPages")).toHaveCount(0);
    } finally {
      await deleteRoot(root.rootId);
    }
  });
});
