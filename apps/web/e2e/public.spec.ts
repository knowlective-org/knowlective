import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { createPrismaClient, emailHash, loadDataKey } from "shared";
import { ACCOUNTS, HOME_PAGE_ID, PASSWORD, adminTotpCode, authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage, typeInBody } from "./helpers";

// Public pages: a site admin allows them in /admin (概要), someone with
// MANAGE publishes a page from its 権限設定, and then anyone can read it
// without logging in. Reads the development database for the admin's last
// used authenticator step (a code can't be used twice), so it needs
// DATABASE_URL (from the root .env).

if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(__dirname, "../../../.env"));

// An authenticator code for a time step the server hasn't seen used yet (it
// accepts one step either side of now).
async function freshAdminCode(): Promise<string> {
  const prisma = createPrismaClient();
  try {
    for (;;) {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { emailHash: emailHash(await loadDataKey(prisma), ACCOUNTS.admin.email) },
        select: { totpLastStep: true },
      });
      const step = Math.floor(Date.now() / 30_000);
      for (const candidate of [step, step + 1]) {
        if (admin.totpLastStep === null || candidate > admin.totpLastStep) return adminTotpCode(candidate * 30_000);
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function setPublicPagesAllowed(page: Page, allowed: boolean) {
  await page.goto("admin");
  // Signed in to /admin already (an earlier call), or not yet.
  if (new URL(page.url()).pathname.includes("/admin/login")) {
    await page.getByTestId("AccountLoginForm.emailInput").fill(ACCOUNTS.admin.email);
    await page.getByTestId("AccountLoginForm.passwordInput").fill(PASSWORD);
    await page.getByTestId("AccountLoginForm.submitButton").click();
    await expect(page).toHaveURL(/\/admin\/login\/verify/);
    await page.getByTestId("CodeField.input").fill(await freshAdminCode());
    await page.getByTestId("VerifyCodeForm.submitButton").click();
    await page.waitForURL((url) => url.pathname.endsWith("/admin"));
  }

  const checkbox = page.getByTestId("PublicPagesForm.allowedCheckbox");
  if ((await checkbox.isChecked()) === allowed) return;
  await checkbox.setChecked(allowed);
  await page.getByTestId("PublicPagesForm.submitButton").click();
  // Allowing asks first.
  if (allowed) await page.getByTestId("AppDialog.confirmButton").click();
  await expect(page.getByTestId("PublicPagesForm.status")).toHaveText("保存しました。");
}

test.describe("ページの公開", () => {
  test.use({ storageState: authFile("admin") });

  test("管理画面で許可すると、公開したページをログインせずに読める", async ({ page, browser }) => {
    test.setTimeout(180_000);
    // Explicitly empty: a new context would otherwise get the admin's
    // signed-in state from test.use().
    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await guestContext.newPage();
    try {
      // Not allowed: the share screen has no 公開 section.
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

      // Someone not logged in reads it, read-only.
      await guest.goto(`pages/${id}`);
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

      // Not allowed any more: the page needs a login again at once.
      await setPublicPagesAllowed(page, false);
      await guest.goto(`pages/${id}`);
      await expect(guest).toHaveURL(/\/login/);

      await page.goto(`pages/${id}`);
      await trashOpenPage(page);
    } finally {
      await guestContext.close();
    }
  });
});
