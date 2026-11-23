import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { CHECKPOINT_EVERY, type VersionRow, encodeVersion, versionState } from "../src/lib/version-chain";

// Versions saved one after another, as the collab server does.
function store() {
  const rows = new Map<string, VersionRow & { depth: number }>();
  let last: string | null = null;
  const read = (id: string) =>
    versionState(
      id,
      async (v) => rows.get(v) ?? null,
      (row) => row.state,
    );
  return {
    rows,
    read,
    async save(doc: Y.Doc) {
      const previous = last ? rows.get(last)! : null;
      const base = previous ? { id: previous.id, depth: previous.depth, state: await read(previous.id) } : null;
      const encoded = encodeVersion(doc, base);
      const id = `v${rows.size}`;
      rows.set(id, { id, ...encoded });
      last = id;
      return id;
    },
  };
}

const textOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getText("t").toString();
};

test("every version reads back as it was", async () => {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  const s = store();
  const saved: [string, string][] = [];
  for (let i = 0; i < CHECKPOINT_EVERY * 2 + 3; i++) {
    text.insert(text.length, `line ${i}. `);
    if (i % 3 === 0) text.delete(0, 2);
    saved.push([await s.save(doc), text.toString()]);
  }
  for (const [id, expected] of saved) assert.equal(textOf(await s.read(id)), expected);
});

test("later versions store only what changed", async () => {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  text.insert(0, "x".repeat(20_000));
  const s = store();
  const first = await s.save(doc);
  text.insert(0, "small edit");
  const second = await s.save(doc);
  assert.equal(s.rows.get(first)!.baseId, null);
  assert.equal(s.rows.get(second)!.baseId, first);
  assert.ok(s.rows.get(second)!.state.length < 1000);
});

test("a whole version comes back regularly", async () => {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  text.insert(0, "x".repeat(5000));
  const s = store();
  for (let i = 0; i < CHECKPOINT_EVERY * 2; i++) {
    text.insert(0, "y");
    await s.save(doc);
  }
  assert.ok(Math.max(...[...s.rows.values()].map((r) => r.depth)) < CHECKPOINT_EVERY);
  assert.equal([...s.rows.values()].filter((r) => r.baseId === null).length, 2);
});

test("text deleted along the way isn't in a version read through its chain", async () => {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  text.insert(0, `keep ${"x".repeat(2000)} `);
  const s = store();
  await s.save(doc);
  text.insert(text.length, "SECRET-VALUE");
  await s.save(doc);
  text.delete(text.length - "SECRET-VALUE".length, "SECRET-VALUE".length);
  const after = await s.save(doc);
  assert.ok(s.rows.get(after)!.baseId);
  const bytes = await s.read(after);
  assert.ok(!Buffer.from(bytes).toString("latin1").includes("SECRET-VALUE"));
});

test("a document that doesn't descend from the base is saved whole", async () => {
  const base = new Y.Doc();
  base.getText("t").insert(0, "x".repeat(3000));
  const other = new Y.Doc();
  other.getText("t").insert(0, "unrelated");
  const encoded = encodeVersion(other, { id: "b", depth: 0, state: Y.encodeStateAsUpdate(base) });
  assert.equal(encoded.baseId, null);
  assert.equal(textOf(encoded.state), "unrelated");
});

test("a broken chain is an error, not a partial page", async () => {
  const load = async (id: string): Promise<VersionRow | null> => (id === "b" ? { id: "b", baseId: "gone", state: new Uint8Array() } : null);
  await assert.rejects(versionState("b", load, (r) => r.state), /broken/);
  const loop = async (id: string): Promise<VersionRow | null> => ({ id, baseId: id, state: new Uint8Array() });
  await assert.rejects(versionState("a", loop, (r) => r.state), /too long/);
});
