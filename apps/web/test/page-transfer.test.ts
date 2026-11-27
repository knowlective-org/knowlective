import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import {
  NO_REMAP,
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  idReplacer,
  parseBundle,
  peopleIn,
  personHash,
  rebuildDoc,
  rebuildState,
} from "../src/lib/page-transfer/format";

const PAGE = "cpage00000000000000000001";
const NEW_PAGE = "cnewpage00000000000000001";
const FILE = "cfile00000000000000000001";
const NEW_FILE = "cnewfile00000000000000001";
const COLUMN = "ccolumn000000000000000001";
const NEW_COLUMN = "cnewcolumn000000000000001";

function block(id: string, content: Y.XmlElement): Y.XmlElement {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", id);
  container.insert(0, [content]);
  return container;
}

// A page with a link, a mention, a TODO, a file, a linked view, a whiteboard
// item and a block lock.
function samplePage(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getText("title").insert(0, "Title");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.applyDelta([
      { insert: "see " },
      { insert: "this", attributes: { link: { href: `/pages/${PAGE}` } } },
      { insert: ` id ${PAGE} in text ` },
    ]);
    const mention = new Y.XmlElement("mention");
    mention.setAttribute("userId", "alice");
    const gone = new Y.XmlElement("mention");
    gone.setAttribute("userId", "bob");
    paragraph.insert(0, [text, mention, gone]);

    const todo = new Y.XmlElement("todo");
    todo.setAttribute("assignee", "bob");
    todo.setAttribute("doneBy", "alice");
    const image = new Y.XmlElement("image");
    image.setAttribute("url", `/api/files/${FILE}`);
    const table = new Y.XmlElement("childTable");
    table.setAttribute("source", PAGE);
    table.setAttribute("hidden", JSON.stringify([COLUMN]));

    doc.getXmlFragment("blocknote").insert(0, [
      block("b1", paragraph),
      block("b2", todo),
      block("b3", image),
      block("b4", table),
    ]);
    const item = new Y.Map<unknown>();
    item.set("type", "rect");
    item.set("link", PAGE);
    item.set("text", `about ${PAGE}`);
    doc.getMap<Y.Map<unknown>>("whiteboard").set("w1", item);
    doc.getMap("slide").set("backgroundImage", `/api/files/${FILE}`);
    doc.getMap("blockLocks").set("b1", "edit");
  });
  return doc;
}

const remap = {
  ids: new Map([
    [PAGE, NEW_PAGE],
    [FILE, NEW_FILE],
    [COLUMN, NEW_COLUMN],
  ]),
  people: new Map<string, string | null>([
    ["alice", "alice-here"],
    ["bob", null],
  ]),
};

function blocks(doc: Y.Doc) {
  return doc.getXmlFragment("blocknote").toArray() as Y.XmlElement[];
}

describe("rebuildDoc", () => {
  test("keeps the content as it is without a remap", () => {
    const source = samplePage();
    const copy = rebuildDoc(source, NO_REMAP);
    assert.equal(copy.getXmlFragment("blocknote").toString(), source.getXmlFragment("blocknote").toString());
    assert.equal(copy.getText("title").toString(), "Title");
    assert.equal(copy.getMap("blockLocks").get("b1"), "edit");
    assert.equal((copy.getMap("whiteboard").get("w1") as Y.Map<unknown>).get("link"), PAGE);
  });

  test("rewrites ids in attributes and marks, not in text", () => {
    const copy = rebuildDoc(samplePage(), remap);
    const [b1, , b3, b4] = blocks(copy);
    assert.equal(b1.getAttribute("id"), "b1");
    const paragraph = b1.toArray()[0] as Y.XmlElement;
    const text = paragraph.toArray()[0] as Y.XmlText;
    const delta = text.toDelta() as { insert: string; attributes?: { link?: { href: string } } }[];
    assert.equal(delta[1].attributes?.link?.href, `/pages/${NEW_PAGE}`);
    assert.equal(delta[2].insert, ` id ${PAGE} in text `);
    assert.equal((b3.toArray()[0] as Y.XmlElement).getAttribute("url"), `/api/files/${NEW_FILE}`);
    const table = b4.toArray()[0] as Y.XmlElement;
    assert.equal(table.getAttribute("source"), NEW_PAGE);
    assert.equal(table.getAttribute("hidden"), JSON.stringify([NEW_COLUMN]));
  });

  test("maps people and removes those the other site doesn't have", () => {
    const copy = rebuildDoc(samplePage(), remap);
    const [b1, b2] = blocks(copy);
    const mentions = (b1.toArray()[0] as Y.XmlElement).toArray().filter((n): n is Y.XmlElement => n instanceof Y.XmlElement);
    assert.deepEqual(
      mentions.map((m) => m.getAttribute("userId")),
      ["alice-here"],
    );
    const todo = b2.toArray()[0] as Y.XmlElement;
    assert.equal(todo.getAttribute("assignee"), "");
    assert.equal(todo.getAttribute("doneBy"), "alice-here");
  });

  test("rewrites the whiteboard's links and images but not its text", () => {
    const copy = rebuildDoc(samplePage(), remap);
    const item = copy.getMap("whiteboard").get("w1") as Y.Map<unknown>;
    assert.equal(item.get("link"), NEW_PAGE);
    assert.equal(item.get("text"), `about ${PAGE}`);
    assert.equal(copy.getMap("slide").get("backgroundImage"), `/api/files/${NEW_FILE}`);
  });

  test("leaves deleted content behind", () => {
    const source = new Y.Doc();
    const title = source.getText("title");
    title.insert(0, "x".repeat(5000));
    title.delete(0, 4999);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, rebuildState(Y.encodeStateAsUpdate(source)));
    assert.equal(copy.getText("title").toString(), "x");
    // Without the deleted characters' history (no gc: they'd be kept).
    const noGc = new Y.Doc({ gc: false });
    Y.applyUpdate(noGc, rebuildState(Y.encodeStateAsUpdate(source)));
    assert.equal(Y.snapshot(noGc).ds.clients.size, 0);
  });
});

describe("idReplacer", () => {
  test("replaces whole ids only", () => {
    const replace = idReplacer(new Map([["cabc12345678", "cnew"]]));
    assert.equal(replace("/pages/cabc12345678"), "/pages/cnew");
    assert.equal(replace("xcabc12345678"), "xcabc12345678");
    assert.equal(replace("cabc12345678x"), "cabc12345678x");
    assert.equal(replace('["cabc12345678","other"]'), '["cnew","other"]');
  });
});

describe("peopleIn", () => {
  test("finds mentions and TODO people", () => {
    assert.deepEqual(peopleIn(samplePage()).sort(), ["alice", "bob"]);
  });
});

describe("personHash", () => {
  test("ignores case and spaces, depends on the salt", () => {
    assert.equal(personHash("salt-0123456789abcdef", " A@Example.com"), personHash("salt-0123456789abcdef", "a@example.com"));
    assert.notEqual(personHash("salt-0123456789abcdef", "a@example.com"), personHash("salt-fedcba9876543210", "a@example.com"));
  });
});

describe("parseBundle", () => {
  const page = (id: string, parentId: string | null, kind = "DOCUMENT") => ({
    id,
    parentId,
    kind,
    title: id,
    shortcutTargetId: null,
    state: null,
    columns: [],
    values: [],
    presentation: null,
    note: null,
  });
  const bundle = (pages: unknown[], extra: Record<string, unknown> = {}) => ({
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    site: "https://example.com",
    exportedAt: new Date().toISOString(),
    salt: "0123456789abcdefghij",
    pages,
    files: [],
    people: [],
    ...extra,
  });

  test("reads a tree", () => {
    const result = parseBundle(bundle([page("a", null), page("b", "a"), page("d", "a", "PRESENTATION"), page("s", "d", "SLIDE")]));
    assert.ok(!("problem" in result));
    assert.equal(result.pages.length, 4);
  });

  test("refuses pages that don't make one tree", () => {
    for (const pages of [
      [page("a", null), page("b", "c"), page("c", "a")], // parent after child
      [page("a", null), page("b", null)], // two tops
      [page("a", "x")], // no top
      [page("a", null), page("a", "a")], // same id twice
      [page("s", null, "SLIDE")], // a slide on its own
      [page("a", null), page("s", "a", "SLIDE")], // a slide in a document
      [page("d", null, "PRESENTATION"), page("b", "d")], // a document in a presentation
      [page("a", null, "SHORTCUT"), page("b", "a")], // under a shortcut
    ]) {
      const result = parseBundle(bundle(pages));
      assert.ok("problem" in result, JSON.stringify(pages.map((p) => p.id)));
    }
  });

  test("refuses another format and malformed values", () => {
    assert.ok("problem" in parseBundle({ ...bundle([page("a", null)]), version: 2 }));
    assert.ok("problem" in parseBundle(bundle([{ ...page("a", null), kind: "ROOT" }])));
    assert.ok("problem" in parseBundle(bundle([{ ...page("a", null), id: "../x" }])));
    assert.ok("problem" in parseBundle(bundle([{ ...page("a", null), state: "not base64!" }])));
    assert.ok("problem" in parseBundle(bundle([page("a", null)], { people: [{ id: "u", emailHash: "nothex" }] })));
    assert.ok("problem" in parseBundle(bundle([page("a", null)], { files: [{ id: "f", name: "", mimeType: "x/y", size: 1, pageId: null }] })));
  });

  test("drops what doesn't belong to the kind", () => {
    const result = parseBundle(bundle([{ ...page("a", null), note: "secret", shortcutTargetId: "x", state: "AAA=" }]));
    assert.ok(!("problem" in result));
    assert.equal(result.pages[0].note, null);
    assert.equal(result.pages[0].shortcutTargetId, null);
  });
});
