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
});
