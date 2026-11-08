import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { openAdmin, setLandingPage } from "./admin-login";
import { withPrisma } from "./db";
import { addPageFromTree, createPage, editorBody, openPage, trashOpenPage, typeInBody } from "./helpers";

// Public pages: a site admin allows them in /admin (overview), someone with
// MANAGE publishes a page from its permission settings, and then anyone can read it
// without logging in.

async function setPublicPagesAllowed(page: Page, allowed: boolean) {
  await setPublicSettings(page, { allowed });
}

// The public pages settings in /admin (overview). Leaves out what isn't given.
async function setPublicSettings(page: Page, settings: { allowed?: boolean; noindex?: boolean }) {
  await openAdmin(page);

  const allowedBox = page.getByTestId("PublicPagesForm.allowedCheckbox");
  const noindexBox = page.getByTestId("PublicPagesForm.noindexCheckbox");
  const wasAllowed = await allowedBox.isChecked();
  const allowedChanges = settings.allowed !== undefined && settings.allowed !== wasAllowed;
  const noindexChanges = settings.noindex !== undefined && settings.noindex !== (await noindexBox.isChecked());
  if (!allowedChanges && !noindexChanges) return;
  if (allowedChanges) await allowedBox.setChecked(settings.allowed!);
  if (noindexChanges) await noindexBox.setChecked(settings.noindex!);
  await page.getByTestId("PublicPagesForm.submitButton").click();
  // Allowing public pages asks first.
  if (allowedChanges && settings.allowed) await page.getByTestId("AppDialog.confirmButton").click();
  await expect(page.getByTestId("PublicPagesForm.status")).toHaveText("保存しました。");
}

test.describe("Public pages", () => {
  test.use({ storageState: authFile("admin") });

  test("once allowed in the admin console, a published page can be read without logging in", async ({ page, browser }) => {
    test.setTimeout(180_000);
    // Explicitly empty: a new context would otherwise get the admin's
    // signed-in state from test.use().
    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await guestContext.newPage();
    try {
      // Not allowed: the share screen has no publishing section.
      await setPublicPagesAllowed(page, false);
      const { id, title } = await createPage(page, "E2E 公開");
      await typeInBody(page, "誰でも読める文章");
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await page.goto(`pages/${id}/share`);
      await expect(page.getByTestId("SharePage.publicSection")).toHaveCount(0);

      // Allowed, and the page published.
      await setPublicPagesAllowed(page, true);
      await page.goto(`pages/${id}/share`);
      await page.getByTestId("PublishForm.submitButton").click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect(page.getByTestId("UnpublishForm.submitButton")).toBeVisible();

      // Someone not logged in reads it, read-only, without collaborative
      // editing: no connection, so no cursors or names either way. Search
      // engines are told to keep it out (the default).
      const sockets: string[] = [];
      guest.on("websocket", (ws) => sockets.push(ws.url()));
      const response = await guest.goto(`pages/${id}`);
      expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      const document = guest.getByTestId("PageView.publicDocument");
      await expect(document).toContainText("誰でも読める文章");
      await expect(document).toContainText(title);
      await expect(guest.getByTestId("PageView.readOnlyBadge")).toHaveText("公開ページ（閲覧のみ）");
      await expect(guest.getByTestId("TitleField")).toHaveCount(0);
      expect(sockets.filter((url) => url.includes("/collab"))).toEqual([]);
      // Edits show at the next load (the open document, before it's stored).
      await page.goto(`pages/${id}`);
      await typeInBody(page, "あとから追記");
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await guest.reload();
      await expect(document).toContainText("あとから追記");
      expect(sockets.filter((url) => url.includes("/collab"))).toEqual([]);
      await expect(guest.getByTestId("PageMenu.button")).toHaveCount(0);
      await expect(guest.getByTestId("Sidebar.loginLink")).toBeVisible();
      await expect(guest.getByTestId("Sidebar.searchInput")).toHaveCount(0);
      // Their sidebar lists the public page, and nothing that isn't public.
      await expect(guest.locator(`[data-ui="DocTree.link"][data-id="${id}"]`)).toBeVisible();
      await expect(guest.locator(`[data-ui="DocTree.link"][data-id="${HOME_PAGE_ID}"]`)).toHaveCount(0);
      // A page that isn't public: the login screen, as before.
      await guest.goto(`pages/${HOME_PAGE_ID}`);
      await expect(guest).toHaveURL(/\/login/);

      // Search engines allowed: no noindex from the next request on.
      await setPublicSettings(page, { noindex: false });
      expect((await guest.goto(`pages/${id}`))?.headers()["x-robots-tag"]).toBeUndefined();
      // …with robots.txt pointing to a sitemap of the public pages, and the
      // page described (lib/seo.ts): the start of its text, its canonical URL,
      // Open Graph and structured data.
      expect(await (await guest.request.get("robots.txt")).text()).toMatch(/Sitemap: \S*\/sitemap\.xml/);
      const sitemap = await (await guest.request.get("sitemap.xml")).text();
      expect(sitemap).toContain(`/pages/${id}</loc>`);
      expect(sitemap).not.toContain(HOME_PAGE_ID);
      await expect(guest.locator('meta[name="description"]')).toHaveAttribute("content", /誰でも読める文章/);
      await expect(guest.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/pages/${id}$`));
      await expect(guest.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
      const article = JSON.parse((await guest.locator('script[type="application/ld+json"]').textContent())!);
      expect(article).toMatchObject({ "@type": "Article", headline: title });
      await setPublicSettings(page, { noindex: true });
      expect((await guest.goto(`pages/${id}`))?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      // Not allowed: no sitemap.
      expect(await (await guest.request.get("robots.txt")).text()).not.toContain("Sitemap");
      expect(await (await guest.request.get("sitemap.xml")).text()).not.toContain("<loc>");

      // The top page: "/" shows it to someone not logged in, as it's public.
      await setLandingPage(page, id);
      await guest.goto("");
      await expect(guest).toHaveURL(new RegExp(`/pages/${id}$`));

      // Not allowed any more: the page needs a login again at once.
      await setPublicPagesAllowed(page, false);
      await guest.goto(`pages/${id}`);
      await expect(guest).toHaveURL(/\/login/);
      // And "/" asks to log in again, though the landing page is still set.
      await guest.goto("");
      await expect(guest).toHaveURL(/\/login/);
      await setLandingPage(page, "");

      await page.goto(`pages/${id}`);
      await trashOpenPage(page);
    } finally {
      await guestContext.close();
    }
  });

  test("the public knowledge roots' order is set in the admin console, for those not logged in only", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await guestContext.newPage();
    const publish = async (id: string) => {
      await page.goto(`pages/${id}/share`);
      await page.getByTestId("PublishForm.submitButton").click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await expect(page.getByTestId("UnpublishForm.submitButton")).toBeVisible();
    };
    try {
      await setPublicPagesAllowed(page, true);
      // A public page in each of the two E2E roots ("E2E サブ" is the newer).
      const first = await createPage(page, "E2E 公開の順 1");
      await publish(first.id);
      await openPage(page, "e2e-second-home");
      await addPageFromTree(page, "e2e-second-home");
      await page.waitForURL((url) => /\/pages\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/e2e-second-home"));
      const secondId = new URL(page.url()).pathname.split("/").pop()!;
      const secondTitle = `E2E 公開の順 2 ${Date.now()}`;
      await page.getByTestId("TitleField").fill(secondTitle);
      await expect(page.getByTestId("PageView.status")).toHaveCount(0);
      await publish(secondId);

      // By default, newest root first.
      const order = async () => {
        const ids = await guest.locator('[data-ui="DocTree.link"]').evaluateAll((links) => links.map((a) => a.getAttribute("data-id")));
        return ids.indexOf(first.id) < ids.indexOf(secondId) ? "first" : "second";
      };
      await guest.goto(`pages/${first.id}`);
      expect(await order()).toBe("second");

      // In the admin console: the older one moved up, and saved.
      await openAdmin(page);
      const rows = page.getByTestId("PublicRootOrderForm.row");
      const firstRow = rows.filter({ hasText: first.title });
      await expect(rows.first()).toContainText(secondTitle);
      await firstRow.getByTestId("PublicRootOrderForm.upButton").click();
      await expect(rows.first()).toContainText(first.title);
      // Saved, the request kept to send again.
      const saving = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
      await page.getByTestId("PublicRootOrderForm.submitButton").click();
      await expect(page.getByTestId("PublicRootOrderForm.status")).toHaveText("保存しました。");
      const request = await saving;
      const saved = () =>
        withPrisma(async (prisma) => (await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { publicRootOrder: true } })).publicRootOrder);
      const order2 = await saved();
      expect(order2.length).toBe(2);
      // The same request from people who aren't admins: refused (the order
      // stays cleared); from the admin, it works.
      await withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { publicRootOrder: [] } }));
      const replay = (context: { request: import("@playwright/test").APIRequestContext }) =>
        context.request.post("admin", {
          headers: { Origin: new URL(baseURL!).origin, "Next-Action": request.headers()["next-action"], "Content-Type": request.headers()["content-type"] },
          data: request.postDataBuffer()!,
          maxRedirects: 0,
        });
      for (const account of ["editor", "viewer"] as const) {
        const context = await browser.newContext({ storageState: authFile(account) });
        await replay(context);
        await context.close();
      }
      await replay(guestContext);
      expect(await saved()).toEqual([]);
      await replay(page.context());
      expect(await saved()).toEqual(order2);

      // Those not logged in see that order; signed-in users keep theirs.
      await guest.reload();
      expect(await order()).toBe("first");
      await openPage(page, HOME_PAGE_ID);
      const mine = await page.locator('[data-ui="Sidebar.root"] > [data-ui="DocTree"] > ul > li > [data-ui="DocTree.row"] [data-ui="DocTree.link"]').allTextContents();
      expect(mine.indexOf("E2E サブ")).toBeLessThan(mine.indexOf("E2E"));

      // (In the other root: back to its home page, not E2E's.)
      await page.goto(`pages/${secondId}`);
      await page.getByTestId("PageMenu.button").click();
      await page.getByTestId("PageMenu.delete").click();
      await page.getByTestId("AppDialog.confirmButton").click();
      await page.waitForURL("**/pages/e2e-second-home");
      await page.goto(`pages/${first.id}`);
      await trashOpenPage(page);
    } finally {
      await withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { publicRootOrder: [] } }));
      await setPublicPagesAllowed(page, false);
      await guestContext.close();
    }
  });
});
