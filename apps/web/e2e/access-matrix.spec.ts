import { type APIRequestContext, type Browser, expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { withPrisma } from "./db";
import { addPageFromTree, attachFile, createPage, editorBody, openPage, trashOpenPage } from "./helpers";

// Who gets what: every screen and route of a page, as each kind of account —
// not logged in, outsider (no group), viewer, editor, and the admin (who
// manages the E2E tree) — and Server Actions posted directly, without the
// screen, by people who mustn't use them.

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
    await attachFile(page, { name: "一覧.txt", type: "text/plain", base64: Buffer.from("matrix").toString("base64") });
    await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(1);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await context.close();
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
      { path: "notifications", expect: { guest: "login", outsider: "ok", viewer: "ok", editor: "ok", admin: "ok" } },
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
      for (const path of ["api/v1/me", `api/v1/pages/${pageId}/chats`, `api/v1/pages/${pageId}/chats/x/messages`, `api/v1/pages/${pageId}/whiteboard`]) {
        expect([401, 403], `${account} ${path}`).toContain((await context.request.get(path)).status());
      }
      expect([401, 403], `${account} whiteboard POST`).toContain(
        (await context.request.post(`api/v1/pages/${pageId}/whiteboard`, { data: { remove: ["x"] } })).status(),
      );
      // For search engines: open to all, and listing no page that isn't public.
      expect((await context.request.get("robots.txt")).status(), `${account} robots.txt`).toBe(200);
      const sitemap = await context.request.get("sitemap.xml");
      expect(sitemap.status(), `${account} sitemap.xml`).toBe(200);
      expect(await sitemap.text(), `${account} sitemap.xml`).not.toContain(pageId);
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

  test("the page picker's and whiteboard block's actions, called directly, show only what each account may see", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    // A whiteboard under the page, its title a marker.
    await openPage(page, pageId);
    await addPageFromTree(page, pageId, "whiteboard");
    await page.waitForURL((url) => !url.pathname.endsWith(`/${pageId}`));
    await expect(page.getByTestId("Whiteboard.canvas")).toBeVisible();
    const boardId = new URL(page.url()).pathname.split("/").pop()!;
    const boardTitle = `E2E 一覧のボード ${Date.now()}`;
    await page.getByTestId("TitleField").fill(boardTitle);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    await expect.poll(() => withPrisma(async (prisma) => (await prisma.page.findUniqueOrThrow({ where: { id: boardId } })).title)).toBe(boardTitle);

    // The actions' ids, from the requests the admin's screen makes when the
    // board is shown in the page (picker, then the board).
    const actions = new Map<string, string>();
    page.on("request", (request) => {
      const id = request.headers()["next-action"];
      const body = request.postData() ?? "";
      if (id && body.startsWith('["whiteboard"')) actions.set("pickable", id);
      if (id && body === JSON.stringify([boardId])) actions.set("embed", id);
    });
    // (In a new page of its own under the page: an empty body.)
    await openPage(page, pageId);
    await addPageFromTree(page, pageId);
    await page.waitForURL((url) => !url.pathname.endsWith(`/${pageId}`) && !url.pathname.endsWith(`/${boardId}`));
    await editorBody(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("/ホワイトボード");
    await page.getByRole("option", { name: /ホワイトボード/ }).first().click();
    await page.getByTestId("WhiteboardEmbed.chooseButton").click();
    await page.getByTestId("PagePickerDialog.pageSelect").selectOption(boardId);
    await page.getByTestId("PagePickerDialog.submitButton").click();
    await expect(page.getByTestId("WhiteboardEmbed.openLink")).toHaveText(boardTitle);
    expect([...actions.keys()].sort()).toEqual(["embed", "pickable"]);

    const origin = new URL(baseURL!).origin;
    const call = async (request: APIRequestContext, action: string, args: unknown[]) => {
      const response = await request.post(`pages/${pageId}`, {
        headers: { Origin: origin, "Next-Action": action, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
        data: JSON.stringify(args),
        maxRedirects: 0,
      });
      return response.text();
    };
    for (const account of ACCOUNTS) {
      const context = await contextFor(browser, account);
      const sees = !["guest", "outsider"].includes(account);
      // The board and its title: for those who can open it.
      const embed = await call(context.request, actions.get("embed")!, [boardId]);
      expect(embed.includes(boardTitle), `${account} embed`).toBe(sees);
      // The pages to choose from: only those the account can see.
      const pickable = await call(context.request, actions.get("pickable")!, ["whiteboard", null]);
      expect(pickable.includes(boardTitle), `${account} pickable`).toBe(sees);
      await context.close();
    }
  });

  test("the child page list and shortcut actions, called directly, give each account only what it may", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    // A child page of the page, its title a marker.
    const childTitle = `E2E 一覧の子ページ ${Date.now()}`;
    await openPage(page, pageId);
    await addPageFromTree(page, pageId);
    await page.waitForURL((url) => !url.pathname.endsWith(`/${pageId}`));
    const childId = new URL(page.url()).pathname.split("/").pop()!;
    await withPrisma((prisma) => prisma.page.update({ where: { id: childId }, data: { title: childTitle } }));

    // The actions' ids, from the requests the admin's screen makes: the page
    // menu's list of child pages, and creating a shortcut to the child under the page.
    const actions = new Map<string, string>();
    page.on("request", (request) => {
      const id = request.headers()["next-action"];
      const body = request.postData() ?? "";
      if (id && body === JSON.stringify([childId, pageId])) actions.set("shortcut", id);
    });
    await openPage(page, pageId);
    await page.getByTestId("PageMenu.button").click();
    await expect(page.getByTestId("PageMenu.childPages")).toBeVisible();
    // (After the menu's page info, loaded with the same argument.)
    await expect(page.getByTestId("PageMenu.ownerGroups")).toBeVisible();
    const listRequest = page.waitForRequest((request) => !!request.headers()["next-action"] && request.postData() === JSON.stringify([pageId]));
    await page.getByTestId("PageMenu.childPages").click();
    actions.set("list", (await listRequest).headers()["next-action"]);
    await expect(page.getByTestId("ChildListDialog.pageLink").filter({ hasText: childTitle })).toBeVisible();
    await page.getByTestId("ChildListDialog.closeButton").click();
    await openPage(page, childId);
    await page.getByTestId("PageMenu.button").click();
    await page.getByTestId("PageMenu.createShortcut").click();
    await page.getByTestId("MoveDialog.parentSelect").selectOption(pageId);
    await page.getByTestId("MoveDialog.submitButton").click();
    await page.waitForURL((url) => url.pathname.endsWith(`/${pageId}`));
    expect([...actions.keys()].sort()).toEqual(["list", "shortcut"]);
    const shortcuts = () => withPrisma((prisma) => prisma.page.count({ where: { kind: "SHORTCUT", shortcutTargetId: childId, deletedAt: null } }));
    expect(await shortcuts()).toBe(1);

    const origin = new URL(baseURL!).origin;
    const call = async (request: APIRequestContext, action: string, args: unknown[]) => {
      const response = await request.post(`pages/${pageId}`, {
        headers: { Origin: origin, "Next-Action": action, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
        data: JSON.stringify(args),
        maxRedirects: 0,
      });
      return response.text();
    };
    for (const account of ACCOUNTS) {
      const context = await contextFor(browser, account);
      // The child pages and their titles: for those who can open the page.
      const list = await call(context.request, actions.get("list")!, [pageId]);
      expect(list.includes(childTitle), `${account} list`).toBe(!["guest", "outsider"].includes(account));
      // A shortcut: only where the account can add a page.
      if (account !== "admin" && account !== "editor") {
        await call(context.request, actions.get("shortcut")!, [childId, pageId]);
        expect(await shortcuts(), `${account} shortcut`).toBe(1);
      }
      await context.close();
    }
    // …and the very same request works for the admin.
    await call(page.request, actions.get("shortcut")!, [childId, pageId]);
    expect(await shortcuts()).toBe(2);
  });

  test("copying another page's attachment, called directly, needs the page's Edit and the file's page", async ({ page, browser, baseURL }) => {
    // The action's id, from the request the admin's editor makes for the
    // page's own attachment when the page opens.
    let action: string | undefined;
    page.on("request", (request) => {
      const id = request.headers()["next-action"];
      if (id && request.postData() === JSON.stringify([pageId, [fileId], false])) action = id;
    });
    await openPage(page, pageId);
    await expect.poll(() => action).toBeTruthy();

    // A file on the admin's own root page (nobody else can open it), and a
    // page the editor can edit.
    const personalPageId = await withPrisma(async (prisma) => {
      const owner = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId }, select: { uploadedById: true } });
      return (await prisma.knowledgeRoot.findUniqueOrThrow({ where: { ownerId: owner.uploadedById! } })).rootPageId!;
    });
    const upload = await page.request.post(`api/files?pageId=${encodeURIComponent(personalPageId)}`, {
      multipart: { file: { name: "一覧.txt", mimeType: "text/plain", buffer: Buffer.from("personal") } },
    });
    expect(upload.status()).toBe(201);
    const personalFile = ((await upload.json()) as { url: string }).url.split("/").pop()!;
    const { id: targetId } = await createPage(page, "E2E 一覧の添付のコピー");
    const copies = () => withPrisma((prisma) => prisma.fileObject.count({ where: { copiedFromId: personalFile } }));

    const origin = new URL(baseURL!).origin;
    const call = (request: APIRequestContext) =>
      request.post(`pages/${targetId}`, {
        headers: { Origin: origin, "Next-Action": action!, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
        data: JSON.stringify([targetId, [personalFile], true]),
        maxRedirects: 0,
      });
    // Refused for those who can't edit the page, and for the editor, who can't
    // open the file's page…
    for (const account of ["guest", "outsider", "viewer", "editor"] as const) {
      const context = await contextFor(browser, account);
      await call(context.request);
      expect(await copies(), account).toBe(0);
      await context.close();
    }
    // …and the very same request works for the admin, who can.
    await call(page.request);
    expect(await copies()).toBe(1);
    await trashOpenPage(page);
  });
});
