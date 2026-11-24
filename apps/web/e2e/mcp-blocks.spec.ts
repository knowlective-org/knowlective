import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { encrypt, loadDataKey } from "shared";
import { ACCOUNTS, HOME_PAGE_ID, type Role, authFile } from "./accounts";
import { userWhere, withPrisma } from "./db";
import { createPage, editorBody, trashOpenPage } from "./helpers";

// Changing single blocks through MCP and the API (lib/api/blocks.ts), with
// the page open in the editor: the change shows there at once.
test.use({ storageState: authFile("editor") });

const createdKeys: string[] = [];

async function setMcp(on: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: on, mcpEnabled: on, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

async function keyFor(role: Role, scope: "READ" | "WRITE"): Promise<string> {
  return withPrisma(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({ where: await userWhere(prisma, ACCOUNTS[role].email) });
    const key = "kn_" + randomBytes(32).toString("base64url");
    const id = randomUUID();
    createdKeys.push(id);
    const name = encrypt(await loadDataKey(prisma), Buffer.from("E2E MCP blocks"), `knowlective:api-key-name:${id}`);
    await prisma.apiKey.create({
      data: { id, userId: user.id, tokenHash: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 11), nameEnc: Uint8Array.from(name), scope },
    });
    return key;
  });
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type Listed = { id: string; type: string; text?: string; props?: Record<string, unknown> };

async function connect(baseURL: string, key: string) {
  const client = new Client({ name: "e2e-blocks", version: "0" });
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

test("one block changed, inserted beside, deleted; settings checked; only by those who can edit", async ({ page, baseURL, request }) => {
  await setMcp(true);
  const { id } = await createPage(page, `E2E MCP ブロック ${Date.now()}`);
  const key = await keyFor("editor", "WRITE");
  const mcp = await connect(baseURL!, key);
  const viewer = await connect(baseURL!, await keyFor("viewer", "WRITE"));
  const outsider = await connect(baseURL!, await keyFor("outsider", "WRITE"));
  const blocks = async () => data(await mcp.call("list_blocks", { pageId: id })).blocks as Listed[];
  try {
    const body = "## 見出し\n\n変える前の文\n\n消す文\n\n- [ ] やること\n\n```mermaid\ngraph TD\n  A-->B\n```\n";
    expect((await mcp.call("append_to_page", { pageId: id, markdown: body })).isError).toBeFalsy();
    await expect(editorBody(page)).toContainText("変える前の文");
    const list = await blocks();
    const of = (text: string) => list.find((b) => b.text === text)!;
    const paragraph = of("変える前の文");
    const heading = of("見出し");
    const todo = list.find((b) => b.type === "todo")!;
    const diagram = list.find((b) => b.type === "mermaid")!;

    // The text, live in the open editor; the block keeps its id.
    expect((await mcp.call("update_block", { pageId: id, blockId: paragraph.id, content: "**変えた**後の文" })).isError).toBeFalsy();
    await expect(editorBody(page).locator("strong", { hasText: "変えた" })).toBeVisible();
    await expect(editorBody(page)).not.toContainText("変える前の文");
    expect((await blocks()).find((b) => b.id === paragraph.id)?.text).toBe("**変えた**後の文");

    // Settings: a heading's level, a TODO's state, a diagram's code.
    expect((await mcp.call("update_block", { pageId: id, blockId: heading.id, props: { level: 4 } })).isError).toBeFalsy();
    await expect(editorBody(page).locator('[data-content-type="heading"][data-level="4"]')).toContainText("見出し");
    expect((await mcp.call("update_block", { pageId: id, blockId: todo.id, props: { checked: true, due: "2026-12-01" } })).isError).toBeFalsy();
    expect((await mcp.call("update_block", { pageId: id, blockId: diagram.id, props: { code: "graph LR\n  X-->Y" } })).isError).toBeFalsy();
    const changed = await blocks();
    expect(changed.find((b) => b.id === todo.id)?.props).toMatchObject({ checked: true, due: "2026-12-01" });
    expect(changed.find((b) => b.id === diagram.id)?.props?.code).toContain("X-->Y");

    // A setting that isn't allowed, or a value that isn't valid.
    const badLevel = await mcp.call("update_block", { pageId: id, blockId: heading.id, props: { level: 1 } });
    expect(badLevel.isError).toBe(true);
    expect((await mcp.call("update_block", { pageId: id, blockId: paragraph.id, props: { id: "other" } })).isError).toBe(true);
    // Pointing a block at a page isn't offered for one the person can't open.
    expect((await mcp.call("update_block", { pageId: id, blockId: "no-such-block", content: "x" })).isError).toBe(true);

    // Inserted just after a block, then that block deleted.
    expect((await mcp.call("insert_blocks", { pageId: id, blockId: paragraph.id, position: "after", markdown: "挿入した文" })).isError).toBeFalsy();
    const inserted = await blocks();
    const at = inserted.findIndex((b) => b.id === paragraph.id);
    expect(inserted[at + 1].text).toBe("挿入した文");
    expect((await mcp.call("delete_block", { pageId: id, blockId: of("消す文").id })).isError).toBeFalsy();
    await expect(editorBody(page)).not.toContainText("消す文");

    // The same through the API.
    const headers = { Authorization: `Bearer ${key}` };
    const listed = await (await request.get(`api/v1/pages/${id}/blocks`, { headers })).json();
    expect(listed.blocks.some((b: Listed) => b.id === paragraph.id)).toBe(true);
    expect((await request.patch(`api/v1/pages/${id}/blocks/${paragraph.id}`, { headers, data: { content: "API で変えた" } })).ok()).toBe(true);
    await expect(editorBody(page)).toContainText("API で変えた");
    expect((await request.patch(`api/v1/pages/${id}/blocks/nope`, { headers, data: { content: "x" } })).status()).toBe(404);
    expect((await request.post(`api/v1/pages/${id}/blocks`, { headers, data: { blockId: paragraph.id, position: "after", markdown: "API の挿入" } })).ok()).toBe(true);
    await expect(editorBody(page)).toContainText("API の挿入");
    const added = (await blocks()).find((b) => b.text === "API の挿入")!;
    expect((await request.delete(`api/v1/pages/${id}/blocks/${added.id}`, { headers })).ok()).toBe(true);
    await expect(editorBody(page)).not.toContainText("API の挿入");

    // A mention written through a block shows as one; the section holding it
    // is then refused by replace_section, which would lose it.
    const people = data(await mcp.call("list_page_people", { pageId: id })).people as { id: string; name: string }[];
    const person = people.find((p) => p.name === ACCOUNTS.viewer.name)!;
    expect((await mcp.call("update_block", { pageId: id, blockId: paragraph.id, content: `API で変えた <@${person.id}>` })).isError).toBeFalsy();
    await expect(editorBody(page).getByTestId("Mention")).toHaveText(`@${person.name}`);
    expect((await blocks()).find((b) => b.id === paragraph.id)?.text).toBe(`API で変えた <@${person.id}>`);
    const section = await mcp.call("replace_section", { pageId: id, heading: "見出し", markdown: "置き換え" });
    expect(section.isError).toBe(true);
    expect(section.content[0].text).toContain("mention");
    await expect(editorBody(page).getByTestId("Mention")).toHaveText(`@${person.name}`);

    // A viewer reads but can't write; someone outside can do neither.
    expect((await viewer.call("list_blocks", { pageId: id })).isError).toBeFalsy();
    const denied = await viewer.call("update_block", { pageId: id, blockId: paragraph.id, content: "閲覧者" });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("can't edit");
    expect((await viewer.call("delete_block", { pageId: id, blockId: paragraph.id })).isError).toBe(true);
    expect((await outsider.call("list_blocks", { pageId: id })).isError).toBe(true);
    expect((await outsider.call("update_block", { pageId: HOME_PAGE_ID, blockId: paragraph.id, content: "x" })).isError).toBe(true);
    await expect(editorBody(page)).toContainText("API で変えた");
  } finally {
    await mcp.close();
    await viewer.close();
    await outsider.close();
  }
  await trashOpenPage(page);
});

test("an extended table made through MCP and the API, its rows and columns added and deleted, live in the editor", async ({ page, baseURL, request }) => {
  await setMcp(true);
  const { id } = await createPage(page, `E2E MCP 拡張テーブル ${Date.now()}`);
  const key = await keyFor("editor", "WRITE");
  const viewerKey = await keyFor("viewer", "WRITE");
  const mcp = await connect(baseURL!, key);
  const viewer = await connect(baseURL!, viewerKey);
  const table = editorBody(page).locator('[data-node-type="gridTable"]');
  const rowsOf = () => table.locator('[data-node-type="gridRow"]');
  try {
    const created = await mcp.call("create_extended_table", {
      pageId: id,
      rows: [["品目", "数量", "状態"], ["**りんご**", 3, "済"], ["みかん", "1,200"]],
      columns: [null, { type: "number" }, { type: "select", options: ["済", "未"] }],
    });
    expect(created.isError).toBeFalsy();
    const tableId = data(created).tableId as string;
    await expect(table.locator("strong", { hasText: "りんご" })).toBeVisible();
    await expect(rowsOf()).toHaveCount(3);
    const listed = (data(await mcp.call("list_blocks", { pageId: id })).blocks as (Listed & { rowCount?: number; columnTypes?: string[] })[]).find((b) => b.id === tableId)!;
    expect(listed).toMatchObject({ type: "gridTable", rowCount: 3, columnTypes: ["text", "number", "select"] });

    // A value that doesn't fit its column is refused, with where.
    const bad = await mcp.call("add_table_rows", { pageId: id, tableId, rows: [["ぶどう", "たくさん"]] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("column 1");
    expect((await mcp.call("add_table_rows", { pageId: id, tableId, at: 1, rows: [["ぶどう", 5, "未"]] })).isError).toBeFalsy();
    await expect(rowsOf()).toHaveCount(4);
    await expect(rowsOf().nth(1)).toContainText("ぶどう");

    expect((await mcp.call("add_table_column", { pageId: id, tableId, type: { type: "date" }, cells: ["期限", "2026-12-01"] })).isError).toBeFalsy();
    await expect(rowsOf().first().locator('[data-node-type="gridCell"]')).toHaveCount(4);
    await expect(rowsOf().first()).toContainText("期限");

    expect((await mcp.call("delete_table_column", { pageId: id, tableId, at: 2 })).isError).toBeFalsy();
    expect((await mcp.call("delete_table_rows", { pageId: id, tableId, at: 3 })).isError).toBeFalsy();
    await expect(rowsOf()).toHaveCount(3);
    await expect(rowsOf().first().locator('[data-node-type="gridCell"]')).toHaveCount(3);
    await expect(table).not.toContainText("みかん");

    // A viewer can't.
    expect((await viewer.call("add_table_rows", { pageId: id, tableId, rows: [["x"]] })).isError).toBe(true);
    expect((await viewer.call("create_extended_table", { pageId: id, rows: [["x"]] })).isError).toBe(true);
    await expect(rowsOf()).toHaveCount(3);

    // The same through the API.
    const headers = { Authorization: `Bearer ${key}` };
    const made = await request.post(`api/v1/pages/${id}/tables`, {
      headers,
      data: { rows: [["API の列", "数"], ["API の行", 7]], columns: [null, { type: "number" }] },
    });
    expect(made.ok()).toBe(true);
    const apiTable = (await made.json()).tableId as string;
    const second = editorBody(page).locator('[data-node-type="gridTable"]').nth(1);
    await expect(second).toContainText("API の行");
    const apiRows = second.locator('[data-node-type="gridRow"]');
    const badRow = await request.post(`api/v1/pages/${id}/tables/${apiTable}/rows`, { headers, data: { rows: [["x", "多い"]] } });
    expect(badRow.status()).toBe(400);
    expect((await request.post(`api/v1/pages/${id}/tables/${apiTable}/rows`, { headers, data: { rows: [["API で足した行", 8]] } })).ok()).toBe(true);
    await expect(apiRows).toHaveCount(3);
    expect((await request.post(`api/v1/pages/${id}/tables/${apiTable}/columns`, { headers, data: { at: 1, cells: ["API の新しい列"] } })).ok()).toBe(true);
    await expect(apiRows.first()).toContainText("API の新しい列");
    expect((await request.delete(`api/v1/pages/${id}/tables/${apiTable}/columns?at=1`, { headers })).ok()).toBe(true);
    await expect(apiRows.first()).not.toContainText("API の新しい列");
    expect((await request.delete(`api/v1/pages/${id}/tables/${apiTable}/rows?at=1&count=2`, { headers })).ok()).toBe(true);
    await expect(apiRows).toHaveCount(1);
    expect((await request.delete(`api/v1/pages/${id}/tables/${apiTable}/rows?at=0`, { headers })).status()).toBe(400);
    expect((await request.post(`api/v1/pages/${id}/tables/nope/rows`, { headers, data: { rows: [["x"]] } })).status()).toBe(404);
    const viewerHeaders = { Authorization: `Bearer ${viewerKey}` };
    expect((await request.post(`api/v1/pages/${id}/tables`, { headers: viewerHeaders, data: { rows: [["x"]] } })).status()).toBe(403);
  } finally {
    await mcp.close();
    await viewer.close();
  }
  await trashOpenPage(page);
});
