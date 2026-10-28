import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { openAdmin } from "./admin-login";

// The admin console's "About" page: this KNOWLECTIVE's version and commit
// (from the working copy in development), and what it runs on.

test.use({ storageState: authFile("admin") });

test("the About page shows the version, the commit and the packages", async ({ page }) => {
  const version = JSON.parse(readFileSync("../../package.json", "utf8")).version as string;
  await openAdmin(page, "/about");
  // "0.1.0+abc1234": the version with the commit (development: from .git).
  await expect(page.getByTestId("AdminAboutPage.version")).toHaveText(new RegExp(`^${version.replaceAll(".", "\\.")}[+][0-9a-f]{7}$`));
  await expect(page.getByTestId("AdminAboutPage.commit")).toHaveText(/^[0-9a-f]{40}$/);
  await expect(page.getByTestId("AdminAboutPage.built")).toHaveText("ビルドなし（開発環境）");
  await expect(page.getByTestId("AdminAboutPage.node")).toHaveText(process.version);
  await expect(page.getByTestId("AdminAboutPage.postgres")).toHaveText(/^\d+/);
  await expect(page.getByTestId("AdminAboutPage.migrations")).toContainText(/^\d{14}_/);
  // Installed versions and licenses, from both parts.
  const next = page.locator('[data-ui="AdminAboutPage.packageRow"][data-id="next"]');
  await expect(next).toContainText(/16\.\d+\.\d+/);
  await expect(next).toContainText("MIT");
  await expect(page.locator('[data-ui="AdminAboutPage.packageRow"][data-id="@prisma/client"]')).toContainText("shared");
  // The version also shows at the bottom of the menu.
  await expect(page.getByTestId("AdminSidebar.version")).toContainText(`KNOWLECTIVE ${version}+`);
});
