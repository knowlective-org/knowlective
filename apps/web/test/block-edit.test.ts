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
