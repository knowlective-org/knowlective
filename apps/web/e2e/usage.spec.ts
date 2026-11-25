import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, authFile } from "./accounts";
import { openAdmin } from "./admin-login";
import { userWhere, withPrisma } from "./db";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// The usage dashboard (/admin/usage): what the site holds now, and calls
// through the API and MCP counted per person, key and tool. Site admins and
// auditors (read-only) see it; nobody else does.

const createdKeys: string[] = [];

async function setApi(on: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: on, mcpEnabled: on, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

async function editorKey(): Promise<{ key: string; id: string }> {
  return withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email) });
    const key = "kn_" + randomBytes(32).toString("base64url");
    const id = randomUUID();
    createdKeys.push(id);
    const name = encrypt(await loadDataKey(prisma), Buffer.from("E2E usage"), `knowlective:api-key-name:${id}`);
    await prisma.apiKey.create({
      data: { id, userId: user.id, tokenHash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 11), nameEnc: Uint8Array.from(name), scope: "WRITE" },
    });
    return { key, id };
  });
}

// Today in this machine's time zone: the server's, which the days are counted in (lib/usage.ts).
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// What's counted for the key (counting isn't awaited by the request).
const countedFor = (keyId: string) =>
  withPrisma(async (prisma) => {
    const rows = await prisma.usageDaily.findMany({ where: { via: `key:${keyId}` }, select: { channel: true, metric: true, detail: true, count: true } });
    return rows.map((r) => `${r.channel}:${r.metric}:${r.detail}:${r.count}`).sort();
  });

test.afterEach(async () => {
  await setApi(false);
  await withPrisma((prisma) => prisma.apiKey.deleteMany({ where: { id: { in: createdKeys.splice(0) } } }));
});

test("API and MCP calls are counted by person, key and tool, and shown to site admins", async ({ browser, request, baseURL }) => {
  await setApi(true);
  const { key, id } = await editorKey();
  const headers = { Authorization: `Bearer ${key}` };
  // Two reads through the API…
  expect((await request.get("api/v1/pages", { headers })).status()).toBe(200);
  expect((await request.get("api/v1/pages", { headers })).status()).toBe(200);
  // …and one tool call through MCP.
  const client = new Client({ name: "e2e-usage", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("api/mcp", baseURL), { requestInit: { headers } }));
  await client.callTool({ name: "list_pages", arguments: {} });
  await client.close();
  await expect.poll(() => countedFor(id)).toEqual(["API:read::2", "MCP:read:list_pages:1"]);

  const context = await browser.newContext({ storageState: authFile("admin") });
  const admin = await context.newPage();
  try {
    await openAdmin(admin, "/usage?days=7");
    await expect(admin.getByTestId("AdminUsagePage.databaseSize")).toBeVisible();
    await expect(admin.getByTestId("AdminUsagePage.rootRow").first()).toBeVisible();
    // The key, its owner and its calls.
    const viaRow = admin.getByTestId("AdminUsagePage.viaRow").filter({ hasText: key.slice(0, 11) });
    await expect(viaRow).toContainText(ACCOUNTS.editor.name);
    await expect(viaRow).toContainText("API, MCP");
    await expect(viaRow.locator("td").nth(3)).toHaveText("3");
    await expect(viaRow.locator("td").nth(4)).toHaveText("0");
    // The person and the tool.
    await expect(admin.getByTestId("AdminUsagePage.personRow").filter({ hasText: ACCOUNTS.editor.name })).toBeVisible();
    await expect(admin.locator('[data-ui="AdminUsagePage.toolRow"][data-id="list_pages"]')).toContainText("読み取り");
    // The period.
    await expect(admin.locator('[data-ui="AdminUsagePage.periodLink"][data-id="7"]')).toHaveAttribute("aria-current", "page");
    await admin.locator('[data-ui="AdminUsagePage.periodLink"][data-id="30"]').click();
    await expect(admin).toHaveURL(/days=30/);
    await expect(admin.getByTestId("UsageChart")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("edits in the editor are counted for the person who made them", async ({ browser }) => {
  // Today's edits by the editor (the day as the server counts it).
  const editsToday = () =>
    withPrisma(async (prisma) => {
      const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS.editor.email), select: { id: true } });
      const rows = await prisma.$queryRaw<{ count: bigint | null }[]>`
        SELECT SUM("count")::bigint AS count FROM "UsageDaily"
        WHERE "userId" = ${user.id} AND "channel" = 'WEB' AND "metric" = 'edit' AND "day" = ${today()}::date`;
      return Number(rows[0]?.count ?? 0);
    });
  const before = await editsToday();
  const context = await browser.newContext({ storageState: authFile("editor") });
  try {
    const page = await context.newPage();
    await createPage(page, "E2E 利用状況");
    await editorBody(page).click();
    await page.keyboard.type("counted");
    // Counted when the collab server stores the page (a few seconds after typing).
    await expect.poll(editsToday, { timeout: 20_000 }).toBeGreaterThan(before);
    await trashOpenPage(page);
  } finally {
    await context.close();
  }
});

test("auditors see the dashboard read-only; content managers and others don't", async ({ browser }) => {
  const auditorContext = await browser.newContext({ storageState: authFile("auditor") });
  const editorContext = await browser.newContext({ storageState: authFile("editor") });
  try {
    const auditor = await auditorContext.newPage();
    await openAdmin(auditor, "/usage", "auditor");
    await expect(auditor.getByTestId("AdminUsagePage")).toBeVisible();
    await expect(auditor.getByTestId("AdminReadOnly")).toBeVisible();

    // Without an admin session: the admin login.
    const editor = await editorContext.newPage();
    await editor.goto("admin/usage");
    await expect(editor).toHaveURL(/\/admin\/login/);
  } finally {
    await auditorContext.close();
    await editorContext.close();
  }
});
