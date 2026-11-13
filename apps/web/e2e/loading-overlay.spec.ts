import { expect, test } from "@playwright/test";
import { authFile } from "./accounts";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// Opening a page covers the whole screen with a loading overlay while its
// data is read (components/loading-overlay.tsx), until the editor has it.
test.use({ storageState: authFile("editor") });

test("a loading overlay covers the screen while a page opens, and goes once it's in", async ({ page }) => {
  const { id } = await createPage(page, "E2E 読み込み中");
  // Elsewhere first, then back to the page through the sidebar, its server
  // response held back for a moment.
  await page.goto("pages/e2e-home");
  await expect(editorBody(page)).toBeVisible();
  await expect(page.getByTestId("LoadingOverlay")).toHaveCount(0);
  await page.route(`**/pages/${id}*`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // (Some requests end before the delay does, e.g. a prefetch dropped.)
    await route.continue().catch(() => {});
  });
  await page.locator(`[data-ui="DocTree.link"][data-id="${id}"]`).first().click();
  await expect(page.getByTestId("LoadingOverlay")).toBeVisible();
  await expect(page.getByTestId("LoadingOverlay")).toHaveText("読み込み中…");
  await expect(editorBody(page)).toBeVisible();
  await expect(page.getByTestId("LoadingOverlay")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await trashOpenPage(page);
});
