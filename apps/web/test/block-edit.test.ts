import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { type BlockEdit, applyBlockEdit, checkBlockEdit, listBlocks, protectMentions, restoreMentions } from "../src/lib/block-edit";

// Changing one block of a page (lib/block-edit.ts).
//   pnpm --filter web test:unit

function element(name: string, attrs: Record<string, unknown>, children: (Y.XmlElement | Y.XmlText)[] = []) {
  const e = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as never);
  if (children.length) e.insert(0, children);
  return e;
}
const textBlock = (id: string, text: string, type = "paragraph", attrs: Record<string, unknown> = {}, nested: Y.XmlElement[] = []) =>
  element("blockContainer", { id }, [
    element(type, attrs, text ? [new Y.XmlText(text)] : []),
    ...(nested.length ? [element("blockGroup", {}, nested)] : []),
  ]);
function docOf(...blocks: Y.XmlElement[]) {
  const doc = new Y.Doc();
  doc.getXmlFragment("blocknote").insert(0, [element("blockGroup", {}, blocks)]);
  return doc;
}
const bodyOf = (...blocks: Y.XmlElement[]) => Y.encodeStateAsUpdate(docOf(...blocks));
const group = (doc: Y.Doc) => doc.getXmlFragment("blocknote").get(0) as Y.XmlElement;
const contentAt = (doc: Y.Doc, i: number) => (group(doc).get(i) as Y.XmlElement).get(0) as Y.XmlElement;
const ids = (doc: Y.Doc) => group(doc).toArray().map((b) => (b as Y.XmlElement).getAttribute("id"));
const base = { people: ["u1"], userId: "me", now: "2026-11-23T00:00:00.000Z", newId: "new" };
const update = (blockId: string, rest: Partial<Extract<BlockEdit, { kind: "update" }>>): BlockEdit => ({ kind: "update", blockId, ...base, ...rest });
const content = (text: string, ...blocks: Y.XmlElement[]) => ({ text, body: bodyOf(...(blocks.length ? blocks : [textBlock("b", text)])) });

function gridDoc(columns: unknown[]) {
  const cell = (id: string, text: string) => element("gridCell", { id }, [textBlock(`${id}-p`, text)]);
  const table = element("gridTable", { id: "t", headerRow: true, columns: JSON.stringify(columns) }, [
    element("gridRow", { id: "r0" }, columns.map((_, i) => cell(`h${i}`, `列${i}`))),
    element("gridRow", { id: "r1" }, columns.map((_, i) => cell(`c${i}`, "v1.600000.c2FsdA.aXY.Y2lwaGVy"))),
  ]);
  return docOf(table);
}

describe("changing one block", () => {
  test("the text changes; the id, the type, its settings and nested blocks stay", () => {
    const doc = docOf(textBlock("a", "前", "heading", { level: 3 }, [textBlock("n", "下")]));
    assert.equal(applyBlockEdit(doc, update("a", { content: content("後") })), null);
    const block = group(doc).get(0) as Y.XmlElement;
    assert.equal(block.getAttribute("id"), "a");
    assert.equal(contentAt(doc, 0).nodeName, "heading");
    assert.equal(contentAt(doc, 0).getAttribute("level") as unknown, 3);
    assert.equal((contentAt(doc, 0).get(0) as Y.XmlText).toString(), "後");
    assert.equal(block.length, 2);
  });

  test("more than one block as a block's text is refused", () => {
    const doc = docOf(textBlock("a", "前"));
    assert.equal(checkBlockEdit(doc, update("a", { content: content("x", textBlock("1", "x"), textBlock("2", "y")) }))?.code, "not_one_block");
  });

  test("settings are an allowlist, each value checked", () => {
    const doc = docOf(textBlock("a", "前", "heading", { level: 2 }), element("blockContainer", { id: "m" }, [element("maskedText", { sealed: "s" })]), element("blockContainer", { id: "f" }, [element("image", { url: "/api/files/x" })]), element("blockContainer", { id: "v" }, [element("videoEmbed", { url: "" })]), element("blockContainer", { id: "l" }, [element("linkPreview", { url: "" })]));
    assert.equal(applyBlockEdit(doc, update("a", { props: { level: 4 } })), null);
    assert.equal(contentAt(doc, 0).getAttribute("level") as unknown, 4);
    for (const [id, props] of [
      ["a", { level: 1 }],
      ["a", { nope: 1 }],
      ["a", { constructor: 1 }],
      ["m", { sealed: "x" }],
      ["f", { url: "https://evil.example/x.png" }],
      ["v", { url: "https://evil.example/embed" }],
      ["l", { url: "javascript:alert(1)" }],
      ["l", { image: "data:image/svg+xml,x" }],
    ] as const) {
      assert.equal(checkBlockEdit(doc, update(id, { props }))?.code, "invalid_prop", JSON.stringify(props));
    }
  });

  test("a TODO: ticked with who and when, those nested too; the assignee is one of the page's people", () => {
    const doc = docOf(textBlock("a", "親", "todo", { checked: false }, [textBlock("b", "子", "todo", { checked: false })]));
    assert.equal(applyBlockEdit(doc, update("a", { props: { checked: true, assignee: "u1", due: "2026/12/1" } })), null);
    const todo = contentAt(doc, 0);
    assert.equal(todo.getAttribute("doneBy"), "me");
    assert.equal(todo.getAttribute("due"), "2026-12-01");
    const nested = ((group(doc).get(0) as Y.XmlElement).get(1) as Y.XmlElement).get(0) as Y.XmlElement;
    assert.equal((nested.get(0) as Y.XmlElement).getAttribute("checked") as unknown, true);
    assert.equal(checkBlockEdit(doc, update("a", { props: { assignee: "stranger" } }))?.code, "invalid_prop");
  });

  test("locks: an edit lock stops changes to it and within it; any lock stops deleting", () => {
    const doc = docOf(textBlock("a", "親", "paragraph", {}, [textBlock("n", "下")]), textBlock("d", "消せない"));
    doc.getMap("blockLocks").set("a", "edit");
    doc.getMap("blockLocks").set("d", "delete");
    assert.equal(checkBlockEdit(doc, update("n", { content: content("x") }))?.code, "blocks_locked");
    assert.equal(checkBlockEdit(doc, { kind: "insert", blockId: "n", position: "after", body: bodyOf(textBlock("x", "x")) })?.code, "blocks_locked");
    assert.equal(checkBlockEdit(doc, { kind: "delete", blockId: "d", newId: "new" })?.code, "blocks_locked");
    assert.equal(checkBlockEdit(doc, update("d", { content: content("変更はできる") })), null);
  });

  test("inserted before or after; deleted; the page keeps a block", () => {
    const doc = docOf(textBlock("a", "1"));
    assert.equal(applyBlockEdit(doc, { kind: "insert", blockId: "a", position: "before", body: bodyOf(textBlock("b", "0")) }), null);
    assert.equal(applyBlockEdit(doc, { kind: "insert", blockId: "a", position: "after", body: bodyOf(textBlock("c", "2")) }), null);
    assert.deepEqual(ids(doc), ["b", "a", "c"]);
    applyBlockEdit(doc, { kind: "delete", blockId: "b", newId: "x" });
    applyBlockEdit(doc, { kind: "delete", blockId: "c", newId: "x" });
    applyBlockEdit(doc, { kind: "delete", blockId: "a", newId: "last" });
    assert.deepEqual(ids(doc), ["last"]);
  });

  test("an extended table's cells: values by the column's type; masked ones never", () => {
    const doc = gridDoc([{ type: "number" }, { type: "select", multiple: false, options: [{ name: "完了", color: "#e3e2e0" }] }, { type: "user" }, { type: "masked" }]);
    assert.equal(applyBlockEdit(doc, update("c0", { content: content("12,000") })), null);
    assert.equal(checkBlockEdit(doc, update("c0", { content: content("たくさん") }))?.code, "invalid_value");
    assert.equal(applyBlockEdit(doc, update("c1", { content: content("完了") })), null);
    assert.equal(checkBlockEdit(doc, update("c1", { content: content("ない") }))?.code, "invalid_value");
    assert.equal(applyBlockEdit(doc, update("c2", { content: content("<@u1>") })), null);
    assert.equal(checkBlockEdit(doc, update("c2", { content: content("stranger") }))?.code, "invalid_value");
    assert.equal(checkBlockEdit(doc, update("c3", { content: content("平文") }))?.code, "masked_cell");
    // A typed cell's inner block isn't changed directly; a row isn't a block to delete.
    assert.equal(checkBlockEdit(doc, update("h0-p", { content: content("見出し") })), null);
    assert.equal(checkBlockEdit(doc, { kind: "delete", blockId: "r1", newId: "x" })?.code, "not_a_block");
  });

  test("an extended table made: header row as text, typed values checked, at the end or beside a block", () => {
    const doc = docOf(textBlock("a", "前"));
    const create = (rows: string[][], extra: Partial<Extract<BlockEdit, { kind: "createGrid" }>> = {}): BlockEdit => ({
      kind: "createGrid",
      blockId: null,
      position: "after",
      rows: rows.map((r) => r.map((text) => ({ text }))),
      headerRow: true,
      headerColumn: false,
      columns: [null, { type: "number" }],
      people: ["u1"],
      idPrefix: "t",
      ...extra,
    });
    // The heading of a number column is text; a value that isn't a number is refused, with where.
    assert.deepEqual(checkBlockEdit(doc, create([["名前", "数"], ["x", "たくさん"]])), { code: "invalid_cell", row: 1, column: 1, type: "number" });
    assert.equal(checkBlockEdit(doc, create([["a", "b", "c"]], { columns: [{ type: "masked" }] })), null);
    assert.equal(checkBlockEdit(doc, create([["a"], ["秘密"]], { columns: [{ type: "masked" }] }))?.code, "masked_cell");
    assert.equal(applyBlockEdit(doc, create([["名前", "数"], ["x", "1,200"], ["y"]])), null);
    assert.deepEqual(ids(doc), ["a", "t"]);
    const table = group(doc).get(1) as Y.XmlElement;
    assert.equal(table.nodeName, "gridTable");
    assert.equal(table.length, 3);
    // Short rows are filled; every row as wide as the table.
    assert.deepEqual(table.toArray().map((r) => (r as Y.XmlElement).length), [2, 2, 2]);
    assert.equal(JSON.parse(table.getAttribute("columns") as string)[1].type, "number");
    assert.equal(((table.get(1) as Y.XmlElement).get(1) as Y.XmlElement).toString().includes("1200"), true);
    // Beside a block.
    assert.equal(applyBlockEdit(doc, create([["前に"]], { blockId: "a", position: "before", idPrefix: "u", columns: [] })), null);
    assert.deepEqual(ids(doc), ["u", "a", "t"]);
    // On an empty page, the empty paragraph goes.
    const empty = docOf(textBlock("e", ""));
    assert.equal(applyBlockEdit(empty, create([["x"]], { columns: [] })), null);
    assert.deepEqual(ids(empty), ["t"]);
  });

  test("an extended table's rows and columns added and deleted; rules, widths and summary follow", () => {
    const doc = gridDoc([{ type: "number" }, null]);
    (group(doc).get(0) as Y.XmlElement).setAttribute("summary", JSON.stringify([{ fn: "sum" }, null]));
    const table = () => group(doc).get(0) as Y.XmlElement;
    const rows = (values: string[][]) => values.map((r) => r.map((text) => ({ text })));
    // Not above the header row; values by the columns' types.
    assert.equal(checkBlockEdit(doc, { kind: "gridRows", blockId: "t", at: 0, rows: rows([["1"]]), people: [], idPrefix: "n" })?.code, "header_row");
    assert.equal(checkBlockEdit(doc, { kind: "gridRows", blockId: "t", at: null, rows: rows([["x"]]), people: [], idPrefix: "n" })?.code, "invalid_cell");
    assert.equal(checkBlockEdit(doc, { kind: "gridRows", blockId: "t", at: null, rows: rows([["1", "a", "b"]]), people: [], idPrefix: "n" })?.code, "too_many_values");
    assert.equal(checkBlockEdit(doc, { kind: "gridRows", blockId: "c0", at: null, rows: rows([["1"]]), people: [], idPrefix: "n" })?.code, "not_a_grid_table");
    assert.equal(applyBlockEdit(doc, { kind: "gridRows", blockId: "t", at: 1, rows: rows([["5", "上"], ["6"]]), people: [], idPrefix: "n" }), null);
    assert.equal(table().length, 4);
    assert.equal((table().get(3) as Y.XmlElement).getAttribute("id"), "r1");

    // A select column at the left: its heading is text, its values options.
    const rule = { type: "select", multiple: false, options: [{ name: "済" }] };
    assert.equal(checkBlockEdit(doc, { kind: "gridColumn", blockId: "t", at: 0, cells: [{ text: "状態" }, { text: "未知" }], rule, people: [], idPrefix: "m" })?.code, "invalid_cell");
    assert.equal(applyBlockEdit(doc, { kind: "gridColumn", blockId: "t", at: 0, cells: [{ text: "状態" }, { text: "済" }], rule, people: [], idPrefix: "m" }), null);
    assert.deepEqual(table().toArray().map((r) => (r as Y.XmlElement).length), [3, 3, 3, 3]);
    const columns = JSON.parse(table().getAttribute("columns") as string);
    assert.deepEqual(columns.map((c: { type: string } | null) => c?.type ?? null), ["select", "number", null]);
    assert.deepEqual(JSON.parse(table().getAttribute("summary") as string), [null, { fn: "sum" }, null]);
    assert.equal(JSON.parse(table().getAttribute("widths") as string).length, 3);

    // Deleted: a column (its rule and summary go too), rows; a table keeps one of each.
    assert.equal(applyBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "column", at: 1, count: 1 }), null);
    assert.deepEqual(JSON.parse(table().getAttribute("columns") as string).map((c: { type: string } | null) => c?.type ?? null), ["select", null]);
    assert.deepEqual(JSON.parse(table().getAttribute("summary") as string), [null, null]);
    assert.equal(checkBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "row", at: 2, count: 5 })?.code, "out_of_range");
    assert.equal(checkBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "row", at: 0, count: 4 })?.code, "keeps_one");
    assert.equal(applyBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "row", at: 1, count: 2 }), null);
    assert.equal(table().length, 2);
  });

  test("an extended table's locks: an edit lock stops every change; a lock inside stops deleting what holds it", () => {
    const doc = gridDoc([null, null]);
    doc.getMap("blockLocks").set("c1-p", "delete");
    assert.equal(checkBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "row", at: 1, count: 1 })?.code, "blocks_locked");
    assert.equal(checkBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "column", at: 1, count: 1 })?.code, "blocks_locked");
    assert.equal(checkBlockEdit(doc, { kind: "gridDelete", blockId: "t", axis: "column", at: 0, count: 1 }), null);
    doc.getMap("blockLocks").set("t", "edit");
    assert.equal(checkBlockEdit(doc, { kind: "gridRows", blockId: "t", at: null, rows: [[{ text: "x" }]], people: [], idPrefix: "n" })?.code, "blocks_locked");
    assert.equal(checkBlockEdit(doc, { kind: "gridColumn", blockId: "t", at: null, cells: [], rule: null, people: [], idPrefix: "n" })?.code, "blocks_locked");
  });

  test("mentions in Markdown: only the page's people, not in code", () => {
    const { markdown, ids: found } = protectMentions("<@u1> と <@stranger>", ["u1"]);
    assert.deepEqual(found, ["u1"]);
    assert.ok(markdown.includes("<@stranger>"));
    const restored = new Y.Doc();
    Y.applyUpdate(restored, restoreMentions(bodyOf(textBlock("a", markdown), textBlock("c", markdown, "codeBlock")), found));
    const paragraph = contentAt(restored, 0);
    assert.equal((paragraph.get(0) as Y.XmlElement).nodeName, "mention");
    assert.equal((paragraph.get(0) as Y.XmlElement).getAttribute("userId"), "u1");
    assert.equal(contentAt(restored, 1).toString().includes("<@u1>"), true);
  });

  test("the list has ids, text and settings, never sealed text", () => {
    const sealed = "v1.600000.c2FsdA.aXY.Y2lwaGVy";
    const listed = listBlocks([
      { id: "h", type: "heading", props: { level: 2, textColor: "default" }, content: [{ type: "text", text: "題 * 名", styles: { bold: true } }] },
      { id: "m", type: "maskedText", props: { sealed } },
      {
        id: "t",
        type: "gridTable",
        props: { headerRow: true, columns: JSON.stringify([{ type: "masked" }, null]) },
        children: [
          { id: "r0", type: "gridRow", children: [{ id: "h0", type: "gridCell", children: [] }, { id: "h1", type: "gridCell", children: [] }] },
          { id: "r1", type: "gridRow", children: [{ id: "c0", type: "gridCell", children: [{ id: "p", type: "paragraph", content: [{ type: "text", text: sealed, styles: {} }] }] }, { id: "c1", type: "gridCell", children: [{ id: "q", type: "paragraph", content: [{ type: "text", text: "文", styles: {} }] }] }] },
        ],
      },
    ]);
    assert.equal(listed[0].text, "**題 \\* 名**");
    assert.deepEqual(listed[0].props, { textColor: "default", level: 2 });
    assert.ok(!JSON.stringify(listed).includes(sealed));
    assert.equal(listed.find((b) => b.id === "c0")?.masked, true);
    assert.equal(listed.find((b) => b.id === "q")?.text, "文");
  });
});
