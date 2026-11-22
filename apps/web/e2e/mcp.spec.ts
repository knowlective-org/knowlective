import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, HOME_PAGE_ID, type Role, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { editorBody, openPage } from "./helpers";

// The MCP server (/api/mcp): an MCP client with a personal API key calls the
// tools as the key's owner. Issuing keys on the account screen is covered by
// api.spec.ts; here they're made in the database. The cleanup turns the API
// and MCP off again and removes the keys and the pages made here.

const createdPages: string[] = [];

async function setMcp(api: boolean, mcp: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: api, mcpEnabled: mcp, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

async function keyFor(role: Role, scope: "READ" | "WRITE"): Promise<string> {
  return withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS[role].email) });
    const key = "kn_" + randomBytes(32).toString("base64url");
    const id = randomUUID();
    const name = encrypt(await loadDataKey(prisma), Buffer.from("E2E MCP"), `knowlective:api-key-name:${id}`);
    await prisma.apiKey.create({
      data: {
        id,
        userId: user.id,
        tokenHash: createHash("sha256").update(key).digest("hex"),
        prefix: key.slice(0, 11),
        nameEnc: Uint8Array.from(name),
        scope,
      },
    });
    return key;
  });
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

async function connect(baseURL: string, key: string) {
  const client = new Client({ name: "e2e", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("api/mcp", baseURL), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }),
  );
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;
  return { client, call, close: () => client.close() };
}

const data = (result: ToolResult) => JSON.parse(result.content[0].text);

test.describe("MCP server", () => {
  test.use({ storageState: authFile("editor") });

  test.beforeEach(async () => {
    await setMcp(true, true);
  });

  test.afterEach(async () => {
    await setMcp(false, false);
    await withPrisma(async (prisma) => {
      await prisma.apiKey.deleteMany({});
      if (createdPages.length > 0) {
        await prisma.page.updateMany({ where: { id: { in: createdPages } }, data: { deletedAt: new Date() } });
      }
    });
    createdPages.length = 0;
  });

  test("an editor's key creates a page, adds to it and replaces a section, seen live in the editor", async ({ page, baseURL }) => {
    const mcp = await connect(baseURL!, await keyFor("editor", "WRITE"));
    try {
      const names = (await mcp.client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(["search", "list_pages", "get_page", "create_page", "append_to_page", "replace_section", "edit_whiteboard"]),
      );
      // No tool replaces a whole page.
      expect(names.some((n) => /replace_page/.test(n))).toBe(false);

      const title = `E2E MCP ${Date.now()}`;
      const created = await mcp.call("create_page", {
        parentId: HOME_PAGE_ID,
        title,
        markdown: "## 計画\n\n最初の案\n\n## タスク\n\n- [ ] 確認する\n\n## メモ\n\n残す",
      });
      expect(created.isError).toBeFalsy();
      const { id } = data(created);
      createdPages.push(id);

      await openPage(page, id);
      await expect(page.getByTestId("TitleField")).toHaveValue(title);
      await expect(editorBody(page)).toContainText("最初の案");

      // Added at the end, live.
      expect((await mcp.call("append_to_page", { pageId: id, markdown: "MCP から追記" })).isError).toBeFalsy();
      await expect(editorBody(page)).toContainText("MCP から追記");

      // A section of plain blocks is replaced; the heading and the rest stay.
      expect((await mcp.call("replace_section", { pageId: id, heading: "計画", markdown: "- 新しい案" })).isError).toBeFalsy();
      await expect(editorBody(page)).toContainText("新しい案");
      await expect(editorBody(page)).not.toContainText("最初の案");
      await expect(editorBody(page)).toContainText("残す");

      // A section with a TODO (a block of knowlective's own) is left alone.
      const refused = await mcp.call("replace_section", { pageId: id, heading: "タスク", markdown: "消す" });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain("todo");
      await expect(editorBody(page).locator('[data-content-type="todo"]')).toHaveCount(1);

      // An unknown heading: nothing changes.
      expect((await mcp.call("replace_section", { pageId: id, heading: "ない見出し", markdown: "x" })).isError).toBe(true);

      // Read back, and found by search.
      const read = await mcp.call("get_page", { pageId: id });
      expect(data(read).title).toBe(title);
      expect(read.content[1].text).toContain("新しい案");
      await expect
        .poll(async () => data(await mcp.call("search", { query: title, mode: "keyword" })).results.map((r: { id: string }) => r.id))
        .toContain(id);
    } finally {
      await mcp.close();
    }
  });

  test("a read-only key gets the reading tools only; a viewer can't write with any key", async ({ baseURL }) => {
    const reader = await connect(baseURL!, await keyFor("viewer", "READ"));
    try {
      const names = (await reader.client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("get_page");
      expect(names).not.toContain("create_page");
      expect(names).not.toContain("append_to_page");
      expect(names).not.toContain("rename_page");
      expect(names).not.toContain("send_notification");
      expect(names).toContain("get_child_properties");
      expect(data(await reader.call("get_page", { pageId: HOME_PAGE_ID })).id).toBe(HOME_PAGE_ID);
    } finally {
      await reader.close();
    }

    const writer = await connect(baseURL!, await keyFor("viewer", "WRITE"));
    try {
      const append = await writer.call("append_to_page", { pageId: HOME_PAGE_ID, markdown: "閲覧者から" });
      expect(append.isError).toBe(true);
      expect(append.content[0].text).toContain("can't edit");
      const create = await writer.call("create_page", { parentId: HOME_PAGE_ID, title: "閲覧者のページ" });
      expect(create.isError).toBe(true);
    } finally {
      await writer.close();
    }
  });

  test("an outsider's key sees nothing of the E2E pages", async ({ baseURL }) => {
    const mcp = await connect(baseURL!, await keyFor("outsider", "WRITE"));
    try {
      const page = await mcp.call("get_page", { pageId: HOME_PAGE_ID });
      expect(page.isError).toBe(true);
      expect(page.content[0].text).not.toContain("E2E");
      expect((await mcp.call("list_pages", { parentId: HOME_PAGE_ID })).isError).toBe(true);
      const listed = JSON.stringify(data(await mcp.call("list_pages", {})));
      expect(listed).not.toContain(HOME_PAGE_ID);
      const found = data(await mcp.call("search", { query: "E2E ホーム", mode: "keyword" }));
      expect(found.results.map((r: { id: string }) => r.id)).not.toContain(HOME_PAGE_ID);
      expect((await mcp.call("append_to_page", { pageId: HOME_PAGE_ID, markdown: "部外者" })).isError).toBe(true);
    } finally {
      await mcp.close();
    }
  });

  test("renames a page, reads child pages' properties, lists a page's people and sends them a notification", async ({ baseURL, browser, page }) => {
    const mcp = await connect(baseURL!, await keyFor("editor", "WRITE"));
    try {
      const stamp = Date.now();
      const parent = data(await mcp.call("create_page", { parentId: HOME_PAGE_ID, title: `E2E MCP 親 ${stamp}` })).id as string;
      createdPages.push(parent);
      const child = data(await mcp.call("create_page", { parentId: parent, title: "E2E MCP 子" })).id as string;

      // Renamed: the title changes, and is read back.
      const renamed = await mcp.call("rename_page", { pageId: parent, title: `E2E MCP 改名 ${stamp}` });
      expect(renamed.isError).toBeFalsy();
      await expect.poll(async () => data(await mcp.call("get_page", { pageId: parent })).title).toBe(`E2E MCP 改名 ${stamp}`);

      // Two columns of the parent's child page table, with the child's values.
      await withPrisma(async (prisma) => {
        const key = await loadDataKey(prisma);
        const seal = (text: string, aad: string) => Uint8Array.from(encrypt(key, Buffer.from(text), aad));
        const memo = randomUUID();
        const state = randomUUID();
        await prisma.pagePropertyDef.create({
          data: { id: memo, pageId: parent, type: "TEXT", position: 0, name: seal("メモ", `knowlective:prop-name:${memo}`) },
        });
        await prisma.pagePropertyDef.create({
          data: {
            id: state,
            pageId: parent,
            type: "SELECT",
            position: 1,
            name: seal("状態", `knowlective:prop-name:${state}`),
            options: seal(JSON.stringify([{ id: "done", name: "完了", color: "#dbeddb" }]), `knowlective:prop-options:${state}`),
          },
        });
        await prisma.pagePropertyValue.create({ data: { pageId: child, defId: memo, value: seal("覚え書き", `knowlective:prop-value:${child}:${memo}`) } });
        await prisma.pagePropertyValue.create({ data: { pageId: child, defId: state, value: seal("done", `knowlective:prop-value:${child}:${state}`) } });
      });
      const all = data(await mcp.call("get_child_properties", { pageId: parent }));
      expect(all.columns).toEqual([
        { name: "メモ", type: "TEXT" },
        { name: "状態", type: "SELECT", options: ["完了"] },
      ]);
      expect(all.children).toHaveLength(1);
      expect(all.children[0]).toMatchObject({ id: child, title: "E2E MCP 子", properties: { メモ: "覚え書き", 状態: "完了" } });
      const one = data(await mcp.call("get_child_properties", { pageId: parent, properties: ["状態"] }));
      expect(one.children[0].properties).toEqual({ 状態: "完了" });
      const unknown = await mcp.call("get_child_properties", { pageId: parent, properties: ["ない列"] });
      expect(unknown.isError).toBe(true);
      expect(unknown.content[0].text).toContain("ない列");

      // The page's people, and a notification to the viewer, with a link.
      const people = data(await mcp.call("list_page_people", { pageId: parent })).people as { id: string; name: string }[];
      const viewer = people.find((p) => p.name === ACCOUNTS.viewer.name);
      expect(viewer).toBeTruthy();
      expect(people.some((p) => p.name === ACCOUNTS.outsider.name)).toBe(false);
      const text = `E2E MCP 通知 ${stamp}
レビューをお願いします: https://example.com/review/${stamp}`;
      const sent = await mcp.call("send_notification", { pageId: parent, userIds: [viewer!.id], text });
      expect(sent.isError).toBeFalsy();
      expect(data(sent).recipients).toBe(1);
      // Only to people of the page.
      const outsiderId = await withPrisma(async (prisma) =>
        (await prisma.user.findFirstOrThrow({ where: await userWhere(prisma, ACCOUNTS.outsider.email), select: { id: true } })).id,
      );
      const refused = await mcp.call("send_notification", { pageId: parent, userIds: [outsiderId], text: "x" });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain(outsiderId);

      // The viewer sees it whole, the URL a link, the heading opening the page.
      const context = await browser.newContext({ storageState: authFile("viewer") });
      try {
        const viewerPage = await context.newPage();
        await viewerPage.goto("notifications");
        const item = viewerPage.getByTestId("NotificationsPage.messageItem").filter({ hasText: `E2E MCP 通知 ${stamp}` });
        await expect(item.getByTestId("NotificationsPage.itemLink")).toContainText(`E2E MCP 改名 ${stamp}`);
        // From the editor, through the key named "E2E MCP".
        await expect(item.getByTestId("NotificationsPage.itemLink")).toContainText(`${ACCOUNTS.editor.name}（E2E MCP）`);
        await expect(item.getByTestId("NotificationsPage.message")).toContainText("レビューをお願いします");
        await expect(item.getByTestId("NotificationsPage.messageLink")).toHaveAttribute("href", `https://example.com/review/${stamp}`);
        await item.getByTestId("NotificationsPage.itemLink").click();
        await viewerPage.waitForURL(`**/pages/${parent}`);
      } finally {
        await context.close();
      }

      // To oneself too (an AI app telling its owner it's done).
      const editor = people.find((p) => p.name === ACCOUNTS.editor.name)!;
      const own = await mcp.call("send_notification", { pageId: parent, userIds: [editor.id], text: `E2E MCP 自分へ ${stamp}` });
      expect(own.isError).toBeFalsy();
      expect(data(own).recipients).toBe(1);
      await page.goto("notifications");
      const mine = page.getByTestId("NotificationsPage.messageItem").filter({ hasText: `E2E MCP 自分へ ${stamp}` });
      await expect(mine.getByTestId("NotificationsPage.itemLink")).toContainText(`${ACCOUNTS.editor.name}（E2E MCP）`);
    } finally {
      await mcp.close();
    }

    // A viewer can't rename or send: they can't edit the page.
    const viewerKey = await connect(baseURL!, await keyFor("viewer", "WRITE"));
    try {
      expect((await viewerKey.call("rename_page", { pageId: HOME_PAGE_ID, title: "閲覧者" })).isError).toBe(true);
      expect((await viewerKey.call("send_notification", { pageId: HOME_PAGE_ID, userIds: ["x"], text: "x" })).isError).toBe(true);
    } finally {
      await viewerKey.close();
    }
  });

  test("off unless both the API and MCP are on; a key is required", async ({ request }) => {
    const key = await keyFor("editor", "READ");
    const post = (headers: Record<string, string>) =>
      request.post("api/mcp", {
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      });
    // Cookies alone (the browser's login) don't count.
    expect((await post({})).status()).toBe(401);
    expect((await post({ Authorization: "Bearer kn_wrong" })).status()).toBe(401);
    await setMcp(true, false);
    expect((await post({ Authorization: `Bearer ${key}` })).status()).toBe(404);
    await setMcp(false, true);
    expect((await post({ Authorization: `Bearer ${key}` })).status()).toBe(404);
  });

  test("the account screen copies the MCP server's address in one click", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("account");
    const section = page.getByTestId("AccountPage.mcpSection");
    await expect(section.getByRole("heading", { name: "MCP", exact: true })).toBeVisible();
    const url = (await section.getByTestId("McpSection.url").textContent())!.trim();
    expect(url).toMatch(/\/api\/mcp$/);
    await section.getByTestId("McpSection.copyButton").click();
    await expect(page.getByText("アドレスをコピーしました。")).toBeVisible();
    // No dialog with a second copy button.
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  });
});
