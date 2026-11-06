import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { withMultiColumn } from "@blocknote/xl-multi-column";

// Deleting a block in a column layout (patches/@blocknote__core@*.patch):
// only the column it emptied goes, so 3 columns become 2, not 1, when
// another column is empty too. An ES module (.mts), like the server's
// Markdown engine: BlockNote's CommonJS build doesn't load under require().
//   pnpm --filter web test:unit

const editor = ServerBlockNoteEditor.create({
  schema: withMultiColumn(BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs })),
}).editor as unknown as {
  document: Block[];
  replaceBlocks(old: Block[], blocks: unknown[]): void;
  removeBlocks(ids: string[]): void;
};
type Block = { type: string; content?: { text: string }[]; children: Block[] };

const col = (id: string, text: string) => ({ type: "column", children: [{ id, type: "paragraph", content: text }] });
const show = (b: Block): string =>
  b.type === "columnList"
    ? `[${b.children.map((c) => c.children.map(show).join(",")).join(" | ")}]`
    : (b.content ?? []).map((x) => x.text).join("") || "_";

function afterRemoving(ids: string[], columns: unknown[]): string {
  editor.replaceBlocks(editor.document, [{ type: "columnList", children: columns }]);
  editor.removeBlocks(ids);
  return editor.document.map(show).join(" ");
}

describe("deleting a block in columns", () => {
  test("three columns become two", () => {
    assert.equal(afterRemoving(["b"], [col("a", "A"), col("b", "B"), col("c", "C")]), "[A | C]");
    assert.equal(afterRemoving(["b"], [col("a", "A"), col("b", "B"), col("c", "")]), "[A | _]");
    assert.equal(afterRemoving(["a"], [col("a", "A"), col("b", ""), col("c", "")]), "[_ | _]");
  });
  test("two columns become one, as before", () => {
    assert.equal(afterRemoving(["b"], [col("a", "A"), col("b", "B")]), "A");
    assert.equal(afterRemoving(["a", "b"], [col("a", "A"), col("b", "B")]), "_");
  });
});
