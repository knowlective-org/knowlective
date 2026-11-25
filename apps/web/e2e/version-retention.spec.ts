import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { withPrisma } from "./db";

// The admin console's page history retention (lib/version-cleanup.ts). The
// deleting itself runs hourly in the server; what it deletes is unit-tested
// (test/version-retention.test.ts). Always put back to "forever": the
// development database's history must not be deleted by a test.

test.use({ storageState: authFile("admin") });

const setting = () =>
  withPrisma((prisma) => prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { versionRetentionDays: true } }));
const settingLogs = () => withPrisma((prisma) => prisma.auditLog.count({ where: { action: "page.version.retention.settings" } }));

test("the retention period is set after a confirmation, and recorded", async ({ page }) => {
  await withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { versionRetentionDays: null } }));
  try {
    await openAdmin(page);
    const form = page.getByTestId("VersionRetentionForm");
    await expect(page.getByTestId("VersionRetentionForm.foreverRadio")).toBeChecked();
    await expect(page.getByTestId("VersionRetentionForm.daysInput")).toBeDisabled();
    const logs = await settingLogs();

    // Cancelling the confirmation saves nothing.
    await page.getByTestId("VersionRetentionForm.daysRadio").check();
    await page.getByTestId("VersionRetentionForm.daysInput").fill("36500");
    await form.getByTestId("VersionRetentionForm.submitButton").click();
    await expect(page.getByTestId("AppDialog.message")).toContainText("36,500日より古い版");
    await page.getByTestId("AppDialog.cancelButton").click();
    expect((await setting()).versionRetentionDays).toBeNull();

    await form.getByTestId("VersionRetentionForm.submitButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("VersionRetentionForm.status")).toHaveText("保存しました。");
    expect((await setting()).versionRetentionDays).toBe(36500);
    expect(await settingLogs()).toBe(logs + 1);
    await expect(page.getByTestId("AdminOverviewPage.versionCleanupStatus")).toBeVisible();

    // Kept after reloading; a longer period doesn't ask.
    await page.reload();
    await expect(page.getByTestId("VersionRetentionForm.daysRadio")).toBeChecked();
    await expect(page.getByTestId("VersionRetentionForm.daysInput")).toHaveValue("36500");

    // Back to forever: no confirmation.
    await page.getByTestId("VersionRetentionForm.foreverRadio").check();
    await form.getByTestId("VersionRetentionForm.submitButton").click();
    await expect(page.getByTestId("VersionRetentionForm.status")).toHaveText("保存しました。");
    expect((await setting()).versionRetentionDays).toBeNull();
    expect(await settingLogs()).toBe(logs + 2);
  } finally {
    await withPrisma((prisma) => prisma.instanceConfig.update({ where: { id: 1 }, data: { versionRetentionDays: null } }));
  }
});
