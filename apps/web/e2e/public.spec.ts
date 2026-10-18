import { type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { openAdmin, setLandingPage } from "./admin-login";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

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

      // Someone not logged in reads it, read-only. Search engines are told
      // to keep it out (the default).
      const response = await guest.goto(`pages/${id}`);
      expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      await expect(editorBody(guest)).toContainText("誰でも読める文章");
      await expect(guest.getByTestId("PageView.readOnlyBadge")).toHaveText("公開ページ（閲覧のみ）");
      await expect(guest.getByTestId("TitleField")).toHaveValue(title);
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
      await setPublicSettings(page, { noindex: true });
      expect((await guest.goto(`pages/${id}`))?.headers()["x-robots-tag"]).toBe("noindex, nofollow");

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
});
