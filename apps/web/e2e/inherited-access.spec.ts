import { type Browser, type Page, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// Narrowing access inherited from the pages above, on a child page's share
// screen: Edit → View / No access, View → No access; never stronger, and
// Manage not at all. Under the E2E home page, "E2E 管理" manages, "E2E 編集"
// edits and "E2E 閲覧" views (the seed's grants on the knowledge root).

test.use({ storageState: authFile("admin") });

const row = (page: Page, groupId: string) => page.locator(`[data-ui="SharePage.inheritedGrantRow"][data-id="${groupId}"]`);

// Opens a page as another account; returns the response status.
async function openAs(browser: Browser, account: "editor" | "viewer", pageId: string) {
  const context = await browser.newContext({ storageState: authFile(account) });
  const page = await context.newPage();
  const status = (await page.goto(`pages/${pageId}`))?.status();
  return { context, page, status };
}

test("inherited access can be narrowed or taken away on a child page, not raised", async ({ page, browser }) => {
  const groups = await withPrisma(async (prisma) =>
    Object.fromEntries(
      (await prisma.group.findMany({ where: { name: { in: ["E2E 管理", "E2E 編集", "E2E 閲覧"] } }, select: { id: true, name: true } })).map(
        (g) => [g.name, g.id],
      ),
    ),
  );
  const manage = groups["E2E 管理"];
  const edit = groups["E2E 編集"];
  const view = groups["E2E 閲覧"];
  const { id } = await createPage(page, "E2E 引き継ぎの変更");
  await expect(page.getByTestId("PageView.status")).toHaveCount(0);
  await page.goto(`pages/${id}/share`);

  // Manage can't be changed; Edit offers Edit, View and No access; View offers View and No access.
  await expect(row(page, manage).getByTestId("SharePage.inheritedFixed")).toContainText("変更できません");
  await expect(row(page, edit).getByTestId("AccessSelect").locator("option")).toHaveText(["編集", "閲覧", "閲覧不可"]);
  await expect(row(page, view).getByTestId("AccessSelect").locator("option")).toHaveText(["閲覧", "閲覧不可"]);
  // Groups that inherit access aren't offered as new grants.
  const addable = page.getByTestId("SharePage.groupSelect").locator("option");
  await expect(addable.filter({ hasText: "E2E 編集" })).toHaveCount(0);

  // Editors: down to View here.
  await row(page, edit).getByTestId("AccessSelect").selectOption("VIEW");
  await row(page, edit).getByTestId("SharePage.overrideButton").click();
  await expect(row(page, edit).getByTestId("SharePage.overriddenStatus")).toBeVisible();
  // Viewers: taken away here.
  await row(page, view).getByTestId("AccessSelect").selectOption("NONE");
  await row(page, view).getByTestId("SharePage.overrideButton").click();
  await expect(row(page, view).getByTestId("SharePage.overriddenStatus")).toBeVisible();

  let editor = await openAs(browser, "editor", id);
  await expect(editor.page.getByTestId("PageView.readOnlyBadge")).toBeVisible();
  await expect(editorBody(editor.page)).toHaveAttribute("contenteditable", "false");
  await editor.context.close();
  const viewer = await openAs(browser, "viewer", id);
  expect(viewer.status).toBe(404);
  await viewer.context.close();

  // Raising, or changing Manage, is refused by the server whatever the form sends.
  const form = row(page, edit).getByTestId("SharePage.overrideForm");
  await form.evaluate((f: HTMLFormElement) => {
    const select = f.querySelector("select")!;
    select.add(new Option("MANAGE", "MANAGE"));
    select.value = "MANAGE";
    f.requestSubmit();
  });
  await expect(page.getByTestId("SharePage.error")).toContainText("強い権限にはできません");
  await row(page, edit)
    .getByTestId("SharePage.overrideForm")
    .evaluate((f: HTMLFormElement, groupId: string) => {
      (f.querySelector('input[name="groupId"]') as HTMLInputElement).value = groupId;
      f.querySelector("select")!.value = "VIEW";
      f.requestSubmit();
    }, manage);
  await expect(page.getByTestId("SharePage.error")).toContainText("変更できません");

  // Back to inheriting: editors can edit again.
  await row(page, edit).getByTestId("SharePage.revertButton").click();
  await expect(row(page, edit).getByTestId("SharePage.overriddenStatus")).toHaveCount(0);
  editor = await openAs(browser, "editor", id);
  await expect(editorBody(editor.page)).toHaveAttribute("contenteditable", "true");
  await editor.context.close();

  // Each change is in the audit log.
  const logged = await withPrisma((prisma) =>
    prisma.auditLog.count({ where: { action: { in: ["page.grant.set", "page.grant.remove"] }, createdAt: { gte: new Date(Date.now() - 120_000) } } }),
  );
  expect(logged).toBeGreaterThanOrEqual(3);

  await openPage(page, id);
  await trashOpenPage(page);
});
