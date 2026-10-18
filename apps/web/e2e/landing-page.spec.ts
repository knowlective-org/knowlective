import { expect, test } from "@playwright/test";
import { ACCOUNTS, HOME_PAGE_ID, authFile } from "./accounts";
import { setLandingPage } from "./admin-login";
import { clearLastPage } from "./db";
import { createPage, trashOpenPage } from "./helpers";

// The top page in /admin (概要): where "/" goes for someone with nowhere else
// to go — logged in with no last opened page, or not logged in (if public).

test.describe("トップページ", () => {
  test.use({ storageState: authFile("admin") });

  test("前回のページがない人に表示し、見られない人には表示しない", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const contexts = await Promise.all([
      browser.newContext({ storageState: authFile("viewer") }),
      browser.newContext({ storageState: authFile("outsider") }),
      browser.newContext({ storageState: { cookies: [], origins: [] } }),
    ]);
    const [viewer, outsider, guest] = await Promise.all(contexts.map((c) => c.newPage()));
    try {
      // A page that isn't public.
      await setLandingPage(page, HOME_PAGE_ID);

      // Logged in, no last page (as just after signing up): the top page.
      await clearLastPage(ACCOUNTS.viewer.email);
      await viewer.goto("");
      await expect(viewer).toHaveURL(new RegExp(`/pages/${HOME_PAGE_ID}$`));

      // With a last page: that one, not the top page.
      const { id } = await createPage(page, "E2E トップページ");
      await page.goto("");
      await expect(page).toHaveURL(new RegExp(`/pages/${id}$`));

      // Can't see the top page: their own first page instead.
      await clearLastPage(ACCOUNTS.outsider.email);
      await outsider.goto("");
      await expect(outsider).toHaveURL(/\/pages\//);
      expect(outsider.url()).not.toContain(HOME_PAGE_ID);

      // Not logged in, and the page isn't public: the login screen.
      await guest.goto("");
      await expect(guest).toHaveURL(/\/login/);

      await page.goto(`pages/${id}`);
      await trashOpenPage(page);
    } finally {
      await setLandingPage(page, "");
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});
