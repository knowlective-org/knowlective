import { type Page, expect, test } from "@playwright/test";
import { createKnowledgeRoot } from "shared";
import { ACCOUNTS, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";

// A knowledge root's favicon (lib/root-favicon.ts): set from the root page's
// menu by those who can manage it, shown in the tab and by the root's name in
// the sidebar to those who can open the root page.
test.use({ storageState: authFile("editor") });

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// A root the editors manage and the viewers see, with one child page.
async function makeRoot(label: string) {
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
          { pageId: root.rootPageId, groupId: editors.id, access: "MANAGE" },
          { pageId: root.rootPageId, groupId: viewers.id, access: "VIEW" },
        ],
      });
      const child = await tx.page.create({
        data: { title: `${label} の子`, rootId: root.rootId, parentId: root.rootPageId, createdById: editor.id },
        select: { id: true },
      });
      return { rootId: root.rootId, rootPageId: root.rootPageId, childId: child.id };
    });
  });
}

const deleteRoot = (rootId: string) =>
  withPrisma((prisma) => prisma.knowledgeRoot.update({ where: { id: rootId }, data: { deletedAt: new Date() } }));

const tabIcon = (page: Page) => page.locator("link[data-root-favicon]");
const sidebarIcon = (page: Page, rootId: string) =>
  page.locator(`[data-ui="Sidebar.root"][data-id="${rootId}"]`).getByTestId("DocTree.rootIcon");

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId("PageMenu.button").click();
  await page.getByTestId("PageMenu.favicon").click();
  const dialog = page.getByTestId("FaviconDialog");
  await expect(dialog.getByTestId("FaviconDialog.current")).toBeVisible();
  await dialog.getByTestId("FaviconDialog.fileInput").setInputFiles(file);
  await dialog.getByTestId("FaviconDialog.submitButton").click();
}

test("a root's favicon is set by its managers, and shown in the tab and the sidebar to those who can open the root page", async ({ page, browser }) => {
  const label = `E2E ファビコン ${Date.now()}`;
  const root = await makeRoot(label);
  try {
    await page.goto(`pages/${root.rootPageId}`);
    await expect(tabIcon(page)).toHaveCount(0);

    // An SVG with a script in it isn't taken.
    await upload(page, {
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await expect(page.getByTestId("FaviconDialog.error")).toBeVisible();
    await page.getByTestId("FaviconDialog.cancelButton").click();

    await upload(page, { name: "icon.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("FaviconDialog")).toHaveCount(0);
    await expect(sidebarIcon(page, root.rootId)).toBeVisible();
    await expect(tabIcon(page)).toHaveCount(1);
    const href = (await tabIcon(page).getAttribute("href"))!;
    const url = new URL(href, page.url()).toString();
    const served = await page.request.get(url);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/png");
    // The site's own icon is set aside meanwhile.
    await expect(page.locator('link[rel~="icon"]:not([data-root-favicon])')).toHaveCount(0);

    // Its other pages have it too; another root's don't (the site's icon back).
    await page.locator(`[data-ui="DocTree.link"][data-id="${root.childId}"]`).first().click();
    await page.waitForURL(`**/pages/${root.childId}`);
    await expect(tabIcon(page)).toHaveCount(1);
    await page.getByTestId("DocTree.link").filter({ hasText: /^E2E$/ }).click();
    await expect(page.getByTestId("TitleField")).toHaveValue("E2E");
    await expect(tabIcon(page)).toHaveCount(0);
    await expect(page.locator('link[rel~="icon"]')).not.toHaveCount(0);

    // A viewer sees it, but can't change it.
    const viewerContext = await browser.newContext({ storageState: authFile("viewer") });
    const viewer = await viewerContext.newPage();
    await viewer.goto(`pages/${root.childId}`);
    await expect(tabIcon(viewer)).toHaveCount(1);
    await expect(sidebarIcon(viewer, root.rootId)).toBeVisible();
    await viewer.goto(`pages/${root.rootPageId}`);
    await viewer.getByTestId("PageMenu.button").click();
    await expect(viewer.getByTestId("PageMenu.favicon")).toHaveCount(0);
    await viewerContext.close();

    // Someone who can't open the root page gets nothing.
    const outsiderContext = await browser.newContext({ storageState: authFile("outsider") });
    expect((await outsiderContext.request.get(url)).status()).toBe(404);
    await outsiderContext.close();

    // Removed: the site's icon again.
    await page.goto(`pages/${root.rootPageId}`);
    await page.getByTestId("PageMenu.button").click();
    await page.getByTestId("PageMenu.favicon").click();
    await expect(page.getByTestId("FaviconDialog.preview")).toBeVisible();
    await page.getByTestId("FaviconDialog.removeButton").click();
    await expect(page.getByTestId("FaviconDialog")).toHaveCount(0);
    await expect(sidebarIcon(page, root.rootId)).toHaveCount(0);
    await expect(tabIcon(page)).toHaveCount(0);
  } finally {
    await deleteRoot(root.rootId);
  }
});

test("the sidebar can be hidden and shown again, and stays as it was left", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("pages/e2e-home");
  const sidebar = page.getByTestId("AppShell.sidebar");
  await expect(sidebar).toBeVisible();
  await expect(page.getByTestId("AppShell.showSidebarButton")).toBeHidden();
  await page.getByTestId("AppShell.hideSidebarButton").click();
  await expect(sidebar).toBeHidden();
  await page.reload();
  await expect(sidebar).toBeHidden();
  await page.getByTestId("AppShell.showSidebarButton").click();
  await expect(sidebar).toBeVisible();
  await page.reload();
  await expect(sidebar).toBeVisible();
  await expect(page.getByTestId("AppShell.showSidebarButton")).toBeHidden();
  // (Its script is the root layout's, and <html> may differ from the server's: React says nothing.)
  expect(errors.filter((e) => e.includes("script") || e.includes("hydrat"))).toEqual([]);
});
