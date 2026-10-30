import { type APIRequestContext, type Browser, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, pasteFile, trashOpenPage } from "./helpers";

// Who gets what: every screen and route of a page, as each kind of account —
// not logged in, outsider (no group), viewer, editor, and the admin (who
// manages the E2E tree) — and the share screen's Server Actions posted
// directly, without the screen, by people who mustn't use them.

type Account = "guest" | "outsider" | "viewer" | "editor" | "admin";
const ACCOUNTS: Account[] = ["guest", "outsider", "viewer", "editor", "admin"];
// What opening a URL should give: the page itself, a 404, the login screen,
// or another path.
type Outcome = "ok" | "404" | "login" | { to: string };

async function contextFor(browser: Browser, account: Account) {
  return browser.newContext({ storageState: account === "guest" ? { cookies: [], origins: [] } : authFile(account) });
}

test.use({ storageState: authFile("admin") });

test.describe("Access matrix", () => {
  let pageId: string;
  let fileId: string;
  let groupId: string;

  test.beforeAll(async ({ browser }) => {
    const context = await contextFor(browser, "admin");
    const page = await context.newPage();
    ({ id: pageId } = await createPage(page, "E2E 権限の一覧"));
    await pasteFile(page, { name: "一覧.txt", type: "text/plain", base64: Buffer.from("matrix").toString("base64") });
    await page.locator('[data-ui="AppDialog.choiceButton"][data-id="attach"]').click();
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(1);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await context.close();
    // The file block shows before the upload is done (on a fresh server, the
    // upload route is compiled first).
    await expect
      .poll(() => withPrisma((prisma) => prisma.fileObject.findFirst({ where: { pageId }, select: { id: true } })), {
        timeout: 60_000,
      })
      .not.toBeNull();
    ({ fileId, groupId } = await withPrisma(async (prisma) => ({
      fileId: (await prisma.fileObject.findFirstOrThrow({ where: { pageId }, select: { id: true } })).id,
      groupId: (await prisma.group.create({ data: { name: `E2E 権限の一覧 ${Date.now()}` } })).id,
    })));
  });

  test.afterAll(async ({ browser }) => {
    if (groupId) await withPrisma((prisma) => prisma.group.delete({ where: { id: groupId } }));
    const context = await contextFor(browser, "admin");
    const page = await context.newPage();
    await openPage(page, pageId);
    await trashOpenPage(page);
    await context.close();
  });

  test("screens and routes answer each account as they should", async ({ browser }) => {
    const pagePath = `/pages/${pageId}`;
    const matrix: { path: string; expect: Record<Account, Outcome> }[] = [
      { path: `pages/${pageId}`, expect: { guest: "login", outsider: "404", viewer: "ok", editor: "ok", admin: "ok" } },
      // Permissions: managers only; others go back to the page.
      {
        path: `pages/${pageId}/share`,
        expect: { guest: "login", outsider: "404", viewer: { to: pagePath }, editor: { to: pagePath }, admin: "ok" },
      },
      { path: `pages/${pageId}/history`, expect: { guest: "login", outsider: "404", viewer: "ok", editor: "ok", admin: "ok" } },
      { path: "account", expect: { guest: "login", outsider: "ok", viewer: "ok", editor: "ok", admin: "ok" } },
      { path: "search?q=matrix", expect: { guest: "login", outsider: "ok", viewer: "ok", editor: "ok", admin: "ok" } },
      { path: "trash", expect: { guest: "login", outsider: "ok", viewer: "ok", editor: "ok", admin: "ok" } },
    ];
    for (const account of ACCOUNTS) {
      const context = await contextFor(browser, account);
      const page = await context.newPage();
      for (const row of matrix) {
        const response = await page.goto(row.path);
        const outcome = row.expect[account];
        const where = `${account} ${row.path}`;
        const path = new URL(page.url()).pathname;
        if (outcome === "404") expect(response?.status(), where).toBe(404);
        else if (outcome === "login") expect(path, where).toMatch(/\/login$/);
        else if (outcome === "ok") {
          expect(response?.status(), where).toBe(200);
          expect(path, where).toMatch(new RegExp(`/${row.path.split("?")[0]}$`));
        } else expect(path, where).toMatch(new RegExp(`${outcome.to}$`));
      }

      // The attachment: only for those who can see its page.
      const file = await context.request.get(`api/files/${fileId}`);
      expect(file.status(), `${account} attachment`).toBe(["guest", "outsider"].includes(account) ? 404 : 200);
      // The API takes keys only: a logged-in browser's cookies don't count
      // (401 without a key; 403 while the API is off in the admin console).
      expect([401, 403], `${account} api`).toContain((await context.request.get("api/v1/me")).status());
      await context.close();
    }
  });

  test("the share screen's actions, posted directly, only work for a manager", async ({ page, browser, baseURL }) => {
    // The action ids, from the screen as its manager sees it (each form
    // carries its action's id for posting without JavaScript).
    await page.goto(`pages/${pageId}/share`);
    const actionField = async (form: string) =>
      (await page.locator(`[data-ui="${form}"] input[name^="$ACTION_ID_"]`).first().getAttribute("name"))!;
    const setGrant = await actionField("SharePage.addGrantForm");
    const origin = new URL(baseURL!).origin;
    const post = (request: APIRequestContext, action: string, fields: Record<string, string>) =>
      request.post(`pages/${pageId}/share`, { headers: { Origin: origin }, multipart: { [action]: "", ...fields }, maxRedirects: 0 });
    const grant = () => withPrisma((prisma) => prisma.pageGrant.findUnique({ where: { pageId_groupId: { pageId, groupId } } }));

    // Giving the test group Manage on the page: refused for everyone else…
    for (const account of ["guest", "outsider", "viewer", "editor"] as const) {
      const context = await contextFor(browser, account);
      await post(context.request, setGrant, { pageId, groupId, access: "MANAGE" });
      expect(await grant(), account).toBeNull();
      await context.close();
    }
    // …and the very same request works for the manager (so the refusals mean something).
    await post(page.request, setGrant, { pageId, groupId, access: "VIEW" });
    await expect.poll(async () => (await grant())?.access).toBe("VIEW");

    // Removing it again: refused for everyone else.
    await page.goto(`pages/${pageId}/share`);
    const removeGrant = await actionField("SharePage.removeGrantForm");
    for (const account of ["guest", "outsider", "viewer", "editor"] as const) {
      const context = await contextFor(browser, account);
      await post(context.request, removeGrant, { pageId, groupId });
      expect((await grant())?.access, account).toBe("VIEW");
      await context.close();
    }
  });
});
