import { type Browser, expect, test } from "@playwright/test";
import { createKnowledgeRoot, ensurePersonalRoot, loadDataKey, sealEmail } from "shared";
import { ACCOUNTS, HOME_PAGE_ID, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { userWhere, withPrisma } from "./db";
import { editorBody, openPage } from "./helpers";

// The built-in auditors group (e2e-auditor is in it, and in no other):
// every page outside the personal roots can be viewed, whatever its grants;
// the admin console can be seen, and nothing in it changed.

// A knowledge root granted to no group at all (made once).
const UNSHARED_PAGE_ID = "e2e-unshared-root-page";

async function unsharedRoot() {
  await withPrisma(async (prisma) => {
    if (await prisma.page.findUnique({ where: { id: UNSHARED_PAGE_ID }, select: { id: true } })) return;
    const admin = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.admin.email), select: { id: true } });
    await prisma.$transaction(async (tx) => {
      const { rootId, rootPageId } = await createKnowledgeRoot(tx, { title: "E2E 共有なし", createdById: admin.id });
      await tx.page.create({ data: { id: UNSHARED_PAGE_ID, title: "E2E 誰にも共有していない", rootId, parentId: rootPageId, createdById: admin.id } });
    });
  });
}

async function as<T>(browser: Browser, role: "auditor" | "editor", fn: (page: import("@playwright/test").Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: authFile(role) });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

test("an auditor views every page but the personal ones, and changes none", async ({ browser }) => {
  await unsharedRoot();
  const editorsOwn = await withPrisma(async (prisma) => {
    const editor = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
    return (await prisma.knowledgeRoot.findUniqueOrThrow({ where: { ownerId: editor.id }, select: { rootPageId: true } })).rootPageId!;
  });

  await as(browser, "auditor", async (page) => {
    // A test page (the auditor is in none of its groups): view only.
    await openPage(page, HOME_PAGE_ID);
    await expect(page.getByTestId("PageView.readOnlyBadge")).toBeVisible();
    await expect(editorBody(page)).toHaveAttribute("contenteditable", "false");
    // A root no group is granted: listed and open.
    await expect(page.getByTestId("DocTree.link").filter({ hasText: /^E2E 共有なし$/ })).toHaveCount(1);
    await openPage(page, UNSHARED_PAGE_ID);
    await expect(page.getByTestId("PageView.readOnlyBadge")).toBeVisible();
    // Someone's personal root: not.
    const response = await page.goto(`pages/${editorsOwn}`);
    expect(response?.status()).toBe(404);
    // Nor can the page's permissions be changed: the permission settings
    // send them back to the page.
    await page.goto(`pages/${HOME_PAGE_ID}/share`);
    await page.waitForURL((url) => url.pathname.endsWith(`/pages/${HOME_PAGE_ID}`));
    await expect(page.getByTestId("SharePage.addGrantForm")).toHaveCount(0);
  });
  // Everyone else sees the unshared root as before: not at all.
  await as(browser, "editor", async (page) => {
    expect((await page.goto(`pages/${UNSHARED_PAGE_ID}`))?.status()).toBe(404);
  });
});

test("an auditor sees the admin console read-only, and its actions refuse them", async ({ page, browser, baseURL }) => {
  // A group to try deleting.
  const groupId = await withPrisma(async (prisma) =>
    (await prisma.group.create({ data: { name: `E2E 監査の削除 ${Date.now()}` }, select: { id: true } })).id,
  );
  const context = await browser.newContext();
  try {
    const auditor = await context.newPage();
    await openAdmin(auditor, "", "auditor");
    // Every section a site admin sees, with the controls disabled.
    await expect(auditor.getByTestId("AdminReadOnly.status")).toBeVisible();
    await expect(auditor.getByTestId("AdminSidebar.navLink")).toHaveText(["概要", "ユーザー", "グループ", "ファイル", "セキュリティ", "バージョン情報"]);
    await expect(auditor.getByTestId("AdminSidebar.nav").locator("..")).toContainText(`${ACCOUNTS.auditor.name} (監査)`);
    await expect(auditor.getByTestId("OutboundProxyForm.urlInput")).toBeDisabled();
    await expect(auditor.getByTestId("LinkPreviewSettingsForm.submitButton")).toBeDisabled();
    await auditor.getByTestId("AdminSidebar.navLink").filter({ hasText: "セキュリティ" }).click();
    await expect(auditor.getByTestId("AdminReadOnly.status")).toBeVisible();
    await auditor.getByTestId("AdminSidebar.navLink").filter({ hasText: "ユーザー" }).click();
    await expect(auditor.getByTestId("AdminUsersPage.userRow").filter({ hasText: ACCOUNTS.editor.email })).toBeVisible();

    // The auditors group: its members listed; it can't be deleted.
    await auditor.getByTestId("AdminSidebar.navLink").filter({ hasText: "グループ" }).click();
    await auditor.getByTestId("AdminGroupsPage.groupLink").filter({ hasText: /^監査$/ }).click();
    await expect(auditor.getByTestId("AdminGroupPage.auditorsNote")).toBeVisible();
    await expect(auditor.getByTestId("AdminGroupPage.memberRow")).toContainText([ACCOUNTS.auditor.name]);
    await expect(auditor.getByTestId("AdminGroupPage.deleteGroupForm")).toHaveCount(0);

    // An action posted directly (its id is in the page): refused for the
    // auditor, and the same request works for a site admin.
    await auditor.goto(`admin/groups/${groupId}`);
    const action = (await auditor.locator('[data-ui="AdminGroupPage.deleteGroupForm"] input[name^="$ACTION_ID_"]').getAttribute("name"))!;
    const origin = new URL(baseURL!).origin;
    const post = (request: import("@playwright/test").APIRequestContext) =>
      request.post(`admin/groups/${groupId}`, { headers: { Origin: origin }, multipart: { [action]: "", id: groupId }, maxRedirects: 0 });
    await post(auditor.request);
    const exists = () => withPrisma((prisma) => prisma.group.count({ where: { id: groupId } }));
    expect(await exists()).toBe(1);
    await openAdmin(page);
    await post(page.request);
    await expect.poll(exists).toBe(0);
  } finally {
    await context.close();
    await withPrisma((prisma) => prisma.group.deleteMany({ where: { id: groupId } }));
  }
});

test("only a site admin can add people to the auditors group, which can't be deleted", async ({ page }) => {
  const auditorsId = await withPrisma(async (prisma) => (await prisma.group.findUniqueOrThrow({ where: { builtIn: "auditors" }, select: { id: true } })).id);
  await openAdmin(page, `/groups/${auditorsId}`);
  await expect(page.getByTestId("AdminGroupPage.auditorsNote")).toBeVisible();
  await expect(page.getByTestId("AdminGroupPage.deleteGroupForm")).toHaveCount(0);
  // Adding the viewer, then removing them again.
  await page.getByTestId("AddMemberForm.searchInput").fill("E2E 閲覧者");
  await page.getByTestId("AddMemberForm.candidateItem").filter({ hasText: ACCOUNTS.viewer.name }).click();
  await page.getByTestId("AddMemberForm.submitButton").click();
  const viewerRow = page.getByTestId("AdminGroupPage.memberRow").filter({ hasText: ACCOUNTS.viewer.email });
  await expect(viewerRow).toBeVisible();
  await viewerRow.getByTestId("RowMenu.toggle").click();
  await page.getByTestId("RowMenu.item").filter({ hasText: "グループから外す" }).click();
  await page.getByTestId("AppDialog.confirmButton").click();
  await expect(viewerRow).toHaveCount(0);
  // Not a group to grant on a page.
  await page.goto(`pages/${HOME_PAGE_ID}/share`);
  await expect(page.getByTestId("SharePage.addGrantForm").locator("option").filter({ hasText: /^監査$/ })).toHaveCount(0);
});

test("while a site admin allows it, an auditor views personal roots from the users list, each view recorded and the owner told", async ({ page, browser }) => {
  const { editorId, editorsOwn } = await withPrisma(async (prisma) => {
    const editor = await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
    const root = await prisma.knowledgeRoot.findUniqueOrThrow({ where: { ownerId: editor.id }, select: { rootPageId: true } });
    return { editorId: editor.id, editorsOwn: root.rootPageId! };
  });
  const setAllowed = async (allowed: boolean) => {
    await openAdmin(page);
    const box = page.getByTestId("AuditorSettingsForm.personalRootsCheckbox");
    await box.setChecked(allowed);
    await page.getByTestId("AuditorSettingsForm.submitButton").click();
    await expect(page.getByTestId("AuditorSettingsForm.status")).toHaveText("保存しました。");
  };
  const views = () => withPrisma((prisma) => prisma.auditLog.count({ where: { action: "personal-page.view", actorId: { not: null } } }));

  // The owner isn't told anything while it isn't allowed.
  await as(browser, "editor", async (editor) => {
    await openPage(editor, editorsOwn);
    await expect(editor.getByTestId("PageView.personalNotice")).toHaveCount(0);
  });

  const auditorContext = await browser.newContext({ storageState: authFile("auditor") });
  try {
    await setAllowed(true);
    const auditor = await auditorContext.newPage();
    await openAdmin(auditor, "/users", "auditor");
    await auditor.locator(`[data-ui="AdminUsersPage.personalRootLink"][data-id="${editorId}"]`).click();
    await auditor.waitForURL((url) => url.pathname.endsWith(`/pages/${editorsOwn}`));
    await expect(auditor.getByTestId("PageView.personalNotice")).toContainText(`${ACCOUNTS.editor.name} さんのマイページを監査として閲覧`);
    await expect(auditor.getByTestId("PageView.readOnlyBadge")).toBeVisible();
    await expect(editorBody(auditor)).toHaveAttribute("contenteditable", "false");
    // Not listed in the auditor's sidebar.
    await expect(auditor.locator(`[data-ui="DocTree.link"][data-id="${editorsOwn}"]`)).toHaveCount(0);
    // Each page opened is recorded once (a reload within minutes isn't
    // recorded again; the server remembers for 10 minutes, across test
    // runs too, so a page made for this run is counted).
    const fresh = await withPrisma(async (prisma) => {
      const root = await prisma.page.findUniqueOrThrow({ where: { id: editorsOwn }, select: { rootId: true } });
      return (await prisma.page.create({ data: { title: "E2E 監査が見るページ", rootId: root.rootId, parentId: editorsOwn, createdById: editorId } })).id;
    });
    const before = await views();
    await openPage(auditor, fresh);
    await expect(auditor.getByTestId("PageView.personalNotice")).toBeVisible();
    await expect.poll(views).toBe(before + 1);
    await auditor.reload();
    await expect(auditor.getByTestId("PageView.personalNotice")).toBeVisible();
    expect(await views()).toBe(before + 1);
    await withPrisma((prisma) => prisma.page.update({ where: { id: fresh }, data: { deletedAt: new Date() } }));

    // A disabled person's too (made once: in no group, with a personal root).
    const gone = await withPrisma(async (prisma) => {
      const email = sealEmail(await loadDataKey(prisma), "e2e-disabled@example.com");
      const user = await prisma.user.upsert({
        where: { emailHash: email.emailHash },
        create: { ...email, name: "E2E 無効化済み", passwordHash: "-", disabledAt: new Date() },
        update: { disabledAt: new Date() },
        select: { id: true },
      });
      await prisma.$transaction((tx) => ensurePersonalRoot(tx, user.id, "マイページ"));
      const root = await prisma.knowledgeRoot.findUniqueOrThrow({ where: { ownerId: user.id }, select: { rootPageId: true } });
      return { id: user.id, rootPageId: root.rootPageId! };
    });
    await openAdmin(auditor, "/users", "auditor");
    await auditor.locator(`[data-ui="AdminUsersPage.personalRootLink"][data-id="${gone.id}"]`).click();
    await auditor.waitForURL((url) => url.pathname.endsWith(`/pages/${gone.rootPageId}`));
    await expect(auditor.getByTestId("PageView.personalNotice")).toContainText("E2E 無効化済み さんのマイページ");

    // The owner is told on their root page.
    await as(browser, "editor", async (editor) => {
      await openPage(editor, editorsOwn);
      await expect(editor.getByTestId("PageView.personalNotice")).toContainText("監査グループのメンバーも閲覧できます");
    });

    // Taken back: closed to them again.
    await setAllowed(false);
    expect((await auditor.goto(`pages/${editorsOwn}`))?.status()).toBe(404);
    await openAdmin(auditor, "/users", "auditor");
    await expect(auditor.getByTestId("AdminUsersPage.personalRootLink")).toHaveCount(0);
  } finally {
    await auditorContext.close();
    await withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { auditorsSeePersonalRoots: false } }));
  }
});
