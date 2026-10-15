import path from "node:path";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "shared";
import { ACCOUNTS, authFile } from "./accounts";

// Email addresses and the audit log are stored encrypted
// (shared/src/personal-data.ts). This looks into the development database
// the tests run against, so it needs DATABASE_URL (read from the root .env).

const TABLES = ["User", "Invitation", "AdminLoginAttempt", "UserLoginAttempt", "AuditLog", "PasswordResetToken"];

test.describe("個人情報の暗号化", () => {
  test.use({ storageState: authFile("editor") });

  test("メールアドレスは DB に平文で残らず、画面には出る", async ({ page }) => {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
    const prisma = createPrismaClient();
    try {
      // Every column of every row, as text.
      for (const table of TABLES) {
        for (const account of Object.values(ACCOUNTS)) {
          const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
            `SELECT count(*) FROM "${table}" t WHERE t::text ILIKE $1`,
            `%${account.email}%`,
          );
          expect(count, `${account.email} in "${table}"`).toBe(BigInt(0));
        }
      }
    } finally {
      await prisma.$disconnect();
    }

    // Opened again for the account's owner.
    await page.goto("account");
    await expect(page.getByTestId("AccountPage.email")).toHaveText(ACCOUNTS.editor.email);
  });
});
