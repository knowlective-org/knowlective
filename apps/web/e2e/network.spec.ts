import { type Browser, type Page, expect, test } from "@playwright/test";
import { HOME_PAGE_ID, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { withPrisma } from "./db";
import { createPage, editorBody, openPage, pasteFile, trashOpenPage } from "./helpers";

// Access by network (admin console → Security). The tests run from this
// machine, so a full-access list of a documentation range (203.0.113.0/24)
// makes the browser "another network". Changed through the admin screen,
// which also clears the settings' cache.

type Flags = { access: boolean; read: boolean; write: boolean; download: boolean; upload: boolean };

async function setNetwork(browser: Browser, fullAccess: string, flags: Flags) {
  const context = await browser.newContext({ storageState: authFile("admin") });
  try {
    const admin = await context.newPage();
    await openAdmin(admin, "/security");
    // After the page is interactive: typed before hydration, the text was
    // appended to the saved value.
    await admin.waitForLoadState("networkidle");
    const input = admin.getByTestId("NetworkAccessForm.fullAccessInput");
    await input.fill(fullAccess);
    await expect(input).toHaveValue(fullAccess);
    for (const key of ["access", "read", "write", "download", "upload"] as const) {
      const box = admin.locator(`[data-ui="NetworkAccessForm.flagCheckbox"][data-id="${key}"]`);
      if (await box.isEnabled()) await box.setChecked(flags[key]);
    }
    await admin.getByTestId("NetworkAccessForm.submitButton").click();
    await expect(admin.getByTestId("NetworkAccessForm.status")).toHaveText("保存しました。");
  } finally {
    await context.close();
  }
}

const OPEN: Flags = { access: true, read: true, write: true, download: true, upload: true };

async function attachText(page: Page) {
  await pasteFile(page, { name: "共有メモ.txt", type: "text/plain", base64: Buffer.from("メモ").toString("base64") });
  await page.locator('[data-ui="AppDialog.choiceButton"][data-id="attach"]').click();
  await expect(editorBody(page).locator('[data-content-type="file"]')).toHaveCount(1);
}

test.use({ storageState: authFile("editor") });

test.describe("Access by network", () => {
  test.afterEach(async ({ browser }) => {
    await setNetwork(browser, "", OPEN);
  });

  test("from another network, only what's allowed works", async ({ page, browser }) => {
    // A page with an attachment, made with full access.
    const { id } = await createPage(page, "E2E ネットワーク");
    await attachText(page);
    await expect(page.getByTestId("PageView.status")).toHaveCount(0);
    const file = await withPrisma((prisma) => prisma.fileObject.findFirstOrThrow({ where: { pageId: id }, select: { id: true } }));
    // Served with full access.
    expect((await page.request.get(`api/files/${file.id}`)).status()).toBe(200);

    // Reading only: the page opens read-only; attachments aren't served and
    // can't be added.
    await setNetwork(browser, "203.0.113.0/24", { access: true, read: true, write: false, download: false, upload: false });
    await openPage(page, id);
    await expect(page.getByTestId("PageView.readOnlyBadge")).toBeVisible();
    const upload = await page.request.post(`api/files?pageId=${id}`, {
      headers: { Origin: new URL(page.url()).origin },
      multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") } },
    });
    expect(upload.status()).toBe(403);
    expect((await page.request.get(`api/files/${file.id}`)).status()).toBe(403);

    // Not even reading: no page opens.
    await setNetwork(browser, "203.0.113.0/24", { access: true, read: false, write: false, download: false, upload: false });
    await page.goto(`pages/${HOME_PAGE_ID}`);
    await expect(editorBody(page)).toHaveCount(0);

    // No access at all: refused before the app, but the admin console stays reachable.
    await setNetwork(browser, "203.0.113.0/24", { access: false, read: false, write: false, download: false, upload: false });
    const denied = await page.goto("login");
    expect(denied?.status()).toBe(403);
    await expect(page.locator("h1")).toHaveText("アクセスできません");

    // Back to no restriction: everything works again.
    await setNetwork(browser, "", OPEN);
    await openPage(page, id);
    await expect(page.getByTestId("PageView.readOnlyBadge")).toHaveCount(0);
    await trashOpenPage(page);
  });

  test("an address in the full-access list keeps full access", async ({ page, browser }) => {
    await setNetwork(browser, "127.0.0.1\n::1", { access: false, read: false, write: false, download: false, upload: false });
    await openPage(page, HOME_PAGE_ID);
    await expect(page.getByTestId("PageView.readOnlyBadge")).toHaveCount(0);
  });
});
