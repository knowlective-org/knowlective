import path from "node:path";
import { type Page, expect } from "@playwright/test";
import { createPrismaClient, emailHash, loadDataKey } from "shared";
import { ACCOUNTS, PASSWORD, adminTotpCode } from "./accounts";

// Signing in to /admin as the E2E site admin, from any test. An
// authenticator code can't be used twice, so the code is for a time step the
// server hasn't seen used yet: this reads the admin's last used step from the
// development database (DATABASE_URL, from the root .env).

if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(__dirname, "../../../.env"));

// An authenticator code for an unused time step (the server accepts one
// step either side of now). Waits if both are used.
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
