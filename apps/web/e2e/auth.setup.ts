import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { ACCOUNTS, type Role, authFile } from "./accounts";
import { signIn } from "./helpers";

// Signs each test account in once and keeps the browser state, so the tests
// start signed in.
mkdirSync(path.join(__dirname, ".auth"), { recursive: true });

for (const role of Object.keys(ACCOUNTS) as Role[]) {
  setup(`sign in: ${role}`, async ({ page }) => {
    await signIn(page, ACCOUNTS[role].email);
    await page.waitForURL((url) => url.pathname !== "/login");
    await expect(page.getByTestId("LoginForm")).toHaveCount(0);
    await page.context().storageState({ path: authFile(role) });
  });
}