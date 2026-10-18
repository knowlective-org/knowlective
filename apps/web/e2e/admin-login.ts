import { type Page, expect } from "@playwright/test";
import { ACCOUNTS, PASSWORD, adminTotpCode } from "./accounts";
import { userWhere, withPrisma } from "./db";

// Signing in to /admin as the E2E site admin, from any test. An
// authenticator code can't be used twice, so the code is for a time step the
// server hasn't seen used yet: this reads the admin's last used step from the
// development database.

// An authenticator code for an unused time step (the server accepts one
// step either side of now). Waits if both are used.
export async function freshAdminCode(): Promise<string> {
  return withPrisma(async (prisma) => {
    for (;;) {
      const admin = await prisma.user.findUniqueOrThrow({
        where: await userWhere(prisma, ACCOUNTS.admin.email),
        select: { totpLastStep: true },
      });
      const step = Math.floor(Date.now() / 30_000);
      for (const candidate of [step, step + 1]) {
        if (admin.totpLastStep === null || candidate > admin.totpLastStep) return adminTotpCode(candidate * 30_000);
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  });
}

// The top page in /admin (概要): a page id, or "" for none.
export async function setLandingPage(page: Page, pageId: string) {
  await openAdmin(page);
  await page.getByTestId("LandingPageForm.pageSelect").selectOption(pageId);
  await page.getByTestId("LandingPageForm.submitButton").click();
  await expect(page.getByTestId("LandingPageForm.status")).toHaveText("保存しました。");
}

// Opens `path` under /admin, signing in first if needed.
export async function openAdmin(page: Page, adminPath = "") {
  await page.goto(`admin${adminPath}`);
  if (!new URL(page.url()).pathname.includes("/admin/login")) return;
  await page.getByTestId("AccountLoginForm.emailInput").fill(ACCOUNTS.admin.email);
  await page.getByTestId("AccountLoginForm.passwordInput").fill(PASSWORD);
  await page.getByTestId("AccountLoginForm.submitButton").click();
  await expect(page).toHaveURL(/\/admin\/login\/verify/);
  await page.getByTestId("CodeField.input").fill(await freshAdminCode());
  await page.getByTestId("VerifyCodeForm.submitButton").click();
  await page.waitForURL((url) => !url.pathname.includes("/admin/login"));
  if (adminPath) await page.goto(`admin${adminPath}`);
}
