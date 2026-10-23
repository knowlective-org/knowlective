import { type APIRequestContext, type Browser, type Page, expect, test } from "@playwright/test";
import { ACCOUNTS, HOME_PAGE_ID, PASSWORD, type Role, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { userWhere, withPrisma } from "./db";
import { editorBody, openPage } from "./helpers";

// The public API (/api/v1) with personal API keys: issued on the account
// screen after confirming the password, then used over HTTP. The cleanup
// turns the API off again and removes the keys and the pages made here.

const createdPages: string[] = [];

async function setApi(enabled: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: enabled, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

// Issues a key on the account screen (confirmed with the password) and
// returns it, as shown once in the dialog.
async function issueKey(page: Page, name: string, scope: "READ" | "WRITE", password = PASSWORD): Promise<string> {
  await page.goto("account");
  await page.getByTestId("ApiKeySection.nameInput").fill(name);
  await page.locator(`[data-ui="ApiKeySection.scopeRadio"][data-id="${scope}"]`).check();
  await page.getByTestId("ApiKeySection.passwordInput").fill(password);
  await page.getByTestId("ApiKeySection.passwordButton").click();
  const key = await page.getByTestId("AppDialog.copyInput").inputValue();
  expect(key).toMatch(/^kn_/);
  await page.getByTestId("AppDialog.closeButton").click();
  return key;
}

async function issueKeyAs(browser: Browser, role: Role, name: string, scope: "READ" | "WRITE") {
  const context = await browser.newContext({ storageState: authFile(role) });
  try {
    return await issueKey(await context.newPage(), name, scope);
  } finally {
    await context.close();
  }
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

async function createViaApi(request: APIRequestContext, key: string, data: Record<string, unknown>) {
  const response = await request.post("api/v1/pages", { headers: auth(key), data });
  if (response.status() === 201) createdPages.push((await response.json()).id);
  return response;
}

// Chromium's virtual authenticator (see passkeys.spec.ts).
async function useVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test.describe("Public API", () => {
  test.use({ storageState: authFile("editor") });

  test.beforeEach(async () => {
    await setApi(true);
  });

  test.afterEach(async () => {
    await setApi(false);
    await withPrisma(async (prisma) => {
      await prisma.apiKey.deleteMany({});
      if (createdPages.length > 0) {
        await prisma.page.updateMany({ where: { id: { in: createdPages } }, data: { deletedAt: new Date() } });
      }
    });
    createdPages.length = 0;
  });

  test("a key from the account screen creates, reads and updates pages as its owner", async ({ page, request }) => {
    // The password is asked for again; a wrong one issues nothing.
    await page.goto("account");
    await page.getByTestId("ApiKeySection.nameInput").fill("E2E のキー");
    await page.getByTestId("ApiKeySection.passwordInput").fill("wrong-password");
    await page.getByTestId("ApiKeySection.passwordButton").click();
    await expect(page.getByTestId("ApiKeySection.error")).toContainText("本人確認ができませんでした");
    await expect(page.getByTestId("ApiKeySection.row")).toHaveCount(0);

    const key = await issueKey(page, "E2E のキー", "WRITE");
    await expect(page.getByTestId("ApiKeySection.row")).toContainText("E2E のキー");

    const me = await request.get("api/v1/me", { headers: auth(key) });
    expect(me.status()).toBe(200);
    expect((await me.json()).user.email).toBe(ACCOUNTS.editor.email);

    // Created under the E2E home page, with Markdown.
    const created = await createViaApi(request, key, {
      parentId: HOME_PAGE_ID,
      title: `API のページ ${Date.now()}`,
      markdown: "## 見出し\n\n本文です\n\n```mermaid\nflowchart TD\n  A-->B\n```\n",
    });
    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.parentId).toBe(HOME_PAGE_ID);
    expect(body.markdown).toContain("## 見出し");
    expect(body.markdown).toContain("```mermaid");

    // It's a page like any other: the editor shows it, the diagram included.
    await openPage(page, body.id);
    await expect(page.getByTestId("TitleField")).toHaveValue(body.title);
    await expect(editorBody(page)).toContainText("本文です");
    await expect(page.getByTestId("MermaidBlock.diagram").locator("svg")).toBeVisible();

    // Updated while open: the open editor shows it at once.
    const updated = await request.patch(`api/v1/pages/${body.id}`, {
      headers: auth(key),
      data: { title: "API で更新", markdown: "書き換えた本文" },
    });
    expect(updated.status()).toBe(200);
    await expect(page.getByTestId("TitleField")).toHaveValue("API で更新");
    await expect(editorBody(page)).toContainText("書き換えた本文");
    await expect(editorBody(page)).not.toContainText("本文です");

    const read = await request.get(`api/v1/pages/${body.id}`, { headers: auth(key) });
    expect((await read.json()).markdown.trim()).toBe("書き換えた本文");
    const list = await request.get("api/v1/pages", { headers: auth(key) });
    expect((await list.json()).pages.map((p: { id: string }) => p.id)).toContain(body.id);

    // Revoked on the account screen: refused from then on.
    await page.goto("account");
    await page.getByTestId("ApiKeySection.revokeButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("ApiKeySection.empty")).toBeVisible();
    expect((await request.get("api/v1/me", { headers: auth(key) })).status()).toBe(401);
  });

  test.describe("with a passkey", () => {
    test.use({ storageState: authFile("outsider") });

    test("an account with a passkey confirms with it", async ({ page, request }) => {
      await useVirtualAuthenticator(page);
      await page.goto("account");
      await page.getByTestId("PasskeyRegisterForm.nameInput").fill("API 用");
      await page.getByTestId("PasskeyRegisterForm.submitButton").click();
      await expect(page.getByTestId("PasskeySection.row")).toHaveCount(1);
      try {
        await page.getByTestId("ApiKeySection.nameInput").fill("パスキーで発行");
        await page.getByTestId("ApiKeySection.passkeyButton").click();
        const key = await page.getByTestId("AppDialog.copyInput").inputValue();
        await page.getByTestId("AppDialog.closeButton").click();
        expect((await request.get("api/v1/me", { headers: auth(key) })).status()).toBe(200);
      } finally {
        await withPrisma(async (prisma) => {
          const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.outsider.email) });
          await prisma.userPasskey.deleteMany({ where: { userId: user.id } });
        });
      }
    });
  });

  test("a key can't do more than its scope, its owner, or the site allows", async ({ browser, request }) => {
    expect((await request.get("api/v1/me")).status()).toBe(401);
    expect((await request.get("api/v1/me", { headers: auth("kn_not-a-key") })).status()).toBe(401);

    // Read only.
    const readKey = await issueKeyAs(browser, "editor", "読み取り用", "READ");
    expect((await request.get(`api/v1/pages/${HOME_PAGE_ID}`, { headers: auth(readKey) })).status()).toBe(200);
    const denied = await createViaApi(request, readKey, { parentId: HOME_PAGE_ID, title: "作れない" });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("insufficient_scope");

    // The owner's permission: a viewer's key reads but can't edit, and pages
    // the owner can't see don't exist for it.
    const viewerKey = await issueKeyAs(browser, "viewer", "閲覧者のキー", "WRITE");
    const patched = await request.patch(`api/v1/pages/${HOME_PAGE_ID}`, {
      headers: auth(viewerKey),
      data: { title: "変えられない" },
    });
    expect((await patched.json()).error.code).toBe("forbidden");
    const outsiderKey = await issueKeyAs(browser, "outsider", "外部の人のキー", "WRITE");
    expect((await request.get(`api/v1/pages/${HOME_PAGE_ID}`, { headers: auth(outsiderKey) })).status()).toBe(404);

    // Owner disabled: the key stops working (and works again once enabled).
    await withPrisma(async (prisma) => {
      await prisma.user.update({ where: await userWhere(prisma, ACCOUNTS.viewer.email), data: { disabledAt: new Date() } });
    });
    try {
      expect((await request.get("api/v1/me", { headers: auth(viewerKey) })).status()).toBe(401);
    } finally {
      await withPrisma(async (prisma) => {
        await prisma.user.update({ where: await userWhere(prisma, ACCOUNTS.viewer.email), data: { disabledAt: null } });
      });
    }
    expect((await request.get("api/v1/me", { headers: auth(viewerKey) })).status()).toBe(200);

    // The API turned off in the admin console: every key is refused.
    const adminContext = await browser.newContext({ storageState: authFile("admin") });
    const admin = await adminContext.newPage();
    await openAdmin(admin, "/users");
    await admin.getByTestId("ApiSettingsForm.enabledCheckbox").uncheck();
    await admin.getByTestId("ApiSettingsForm.submitButton").click();
    await expect(admin.getByTestId("ApiSettingsForm.status")).toHaveText("保存しました。");
    await adminContext.close();
    const off = await request.get("api/v1/me", { headers: auth(readKey) });
    expect(off.status()).toBe(403);
    expect((await off.json()).error.code).toBe("api_disabled");
  });
});
