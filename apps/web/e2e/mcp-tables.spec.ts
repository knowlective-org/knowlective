import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, type Role, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { clickInEditor, createPage, editorBody, trashOpenPage } from "./helpers";

// Reading a page's tables through MCP and the API (lib/api/page-tables.ts):
// a table, an extended table and a child page table, whole or by column, only
// for those who can open the page.
test.use({ storageState: authFile("editor") });

async function setMcp(on: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: on, mcpEnabled: on, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

const createdKeys: string[] = [];

async function keyFor(role: Role, scope: "READ" | "WRITE"): Promise<string> {
  return withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS[role].email) });
    const key = "kn_" + randomBytes(32).toString("base64url");
    const id = randomUUID();
    createdKeys.push(id);
    const name = encrypt(await loadDataKey(prisma), Buffer.from("E2E MCP tables"), `knowlective:api-key-name:${id}`);
    await prisma.apiKey.create({
      data: { id, userId: user.id, tokenHash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 11), nameEnc: Uint8Array.from(name), scope },
    });
    return key;
  });
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

async function connect(baseURL: string, key: string) {
  const client = new Client({ name: "e2e-tables", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("api/mcp", baseURL), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return {
    call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<ToolResult>,
    close: () => client.close(),
  };
}
const data = (r: ToolResult) => JSON.parse(r.content[0].text);

test.afterEach(async () => {
  await setMcp(false);
  await withPrisma((prisma) => prisma.apiKey.deleteMany({ where: { id: { in: createdKeys.splice(0) } } }));
});

test("a page's tables: listed, read whole and by column, not by someone who can't open the page", async ({ page, baseURL, request }) => {
  await setMcp(true);
  const { id } = await createPage(page, `E2E MCP 表 ${Date.now()}`);
  const key = await keyFor("editor", "WRITE");
  const mcp = await connect(baseURL!, key);
  const outsider = await connect(baseURL!, await keyFor("outsider", "READ"));
  try {
    // A child page table and an extended table from the editor (each leaves
    // the caret in a new paragraph after it), then a table through MCP.
    await editorBody(page).click();
    await page.keyboard.type("/子ページテーブル");
    await page.getByRole("option", { name: /子ページテーブル/ }).first().click();
    await expect(page.getByTestId("ChildTableBlock")).toBeVisible();
    await page.keyboard.type("/拡張テーブル");
    await page.getByRole("option", { name: /拡張テーブル/ }).click();
    const cells = page.getByTestId("GridTable.cell");
    await clickInEditor(cells.nth(0).locator(".bn-inline-content").first());
    await page.keyboard.type("項目");
    await clickInEditor(cells.nth(3).locator(".bn-inline-content").first());
    await page.keyboard.type("拡張の値");
    expect((await mcp.call("append_to_page", { pageId: id, markdown: "## 表の節\n\n| 名前 | 値 |\n| --- | --- |\n| りんご | 3 |\n| みかん | 5 |\n" })).isError).toBeFalsy();
    await expect(editorBody(page).locator("table")).toBeVisible();

    const child = data(await mcp.call("create_page", { parentId: id, title: "E2E 子の行" })).id as string;
    await withPrisma(async (prisma) => {
      const seal = async (text: string, aad: string) => Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(text), aad));
      const def = randomUUID();
      await prisma.pagePropertyDef.create({ data: { id: def, pageId: id, type: "TEXT", position: 0, name: await seal("メモ", `knowlective:prop-name:${def}`) } });
      await prisma.pagePropertyValue.create({ data: { pageId: child, defId: def, value: await seal("子の値", `knowlective:prop-value:${child}:${def}`) } });
    });

    type Summary = { id: string; kind: string; heading: string | null; rowCount: number; columns: { name: string }[] };
    let tables: Summary[] = [];
    await expect
      .poll(async () => {
        tables = data(await mcp.call("list_tables", { pageId: id })).tables;
        return tables.map((t) => t.kind);
      })
      .toEqual(["childTable", "extendedTable", "table"]);
    tables.reverse();
    expect(tables[0]).toMatchObject({ heading: "表の節", rowCount: 2 });
    expect(tables[2].rowCount).toBe(1);

    // Whole, then one column.
    const whole = data(await mcp.call("get_table", { pageId: id, tableId: tables[0].id }));
    expect(whole.rows.map((r: { values: unknown }) => r.values)).toEqual([{ 名前: "りんご", 値: "3" }, { 名前: "みかん", 値: "5" }]);
    expect(whole).toMatchObject({ totalRows: 2, nextOffset: null });
    const column = data(await mcp.call("get_table", { pageId: id, tableId: tables[0].id, columns: ["値"] }));
    expect(column.columns.map((c: { name: string }) => c.name)).toEqual(["値"]);
    expect(column.rows.map((r: { values: unknown }) => r.values)).toEqual([{ 値: "3" }, { 値: "5" }]);
    const paged = data(await mcp.call("get_table", { pageId: id, tableId: tables[0].id, limit: 1 }));
    expect(paged).toMatchObject({ totalRows: 2, nextOffset: 1 });
    const unknown = await mcp.call("get_table", { pageId: id, tableId: tables[0].id, columns: ["ない列"] });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain("ない列");

    await expect
      .poll(async () => data(await mcp.call("get_table", { pageId: id, tableId: tables[1].id, columns: ["項目"] })).rows[0]?.values)
      .toEqual({ 項目: "拡張の値" });
    const children = data(await mcp.call("get_table", { pageId: id, tableId: tables[2].id, columns: ["メモ"] }));
    expect(children.rows[0]).toMatchObject({ id: child, title: "E2E 子の行", values: { メモ: "子の値" } });

    // The same through the API.
    const headers = { Authorization: `Bearer ${key}` };
    const listed = await (await request.get(`api/v1/pages/${id}/tables`, { headers })).json();
    expect(listed.tables).toHaveLength(3);
    const byColumn = await (await request.get(`api/v1/pages/${id}/tables/${tables[0].id}?column=${encodeURIComponent("名前")}`, { headers })).json();
    expect(byColumn.rows[1].values).toEqual({ 名前: "みかん" });
    expect((await request.get(`api/v1/pages/${id}/tables/nope`, { headers })).status()).toBe(404);
    expect((await request.get(`api/v1/pages/${id}/tables/${tables[0].id}?limit=0`, { headers })).status()).toBe(400);

    // Someone who can't open the page gets neither.
    expect((await outsider.call("list_tables", { pageId: id })).isError).toBe(true);
    expect((await outsider.call("get_table", { pageId: id, tableId: tables[0].id })).isError).toBe(true);
  } finally {
    await mcp.close();
    await outsider.close();
  }
  await trashOpenPage(page);
});
