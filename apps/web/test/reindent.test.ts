import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reindent } from "../src/lib/reindent";
import { insideCodeFence, lineIndent } from "../src/lib/auto-indent";

// The code block's "Format" for languages without a formatter (lib/reindent.ts).
//   pnpm --filter web test:unit

describe("changing indentation", () => {
  test("each level becomes one of the new unit", () => {
    const python = "def f():\n    if x:\n        return 1\n    return 2";
    assert.equal(reindent(python, "2"), "def f():\n  if x:\n    return 1\n  return 2");
    assert.equal(reindent(python, "tab"), "def f():\n\tif x:\n\t\treturn 1\n\treturn 2");
    assert.equal(reindent("a\n  b\n    c", "4"), "a\n    b\n        c");
  });
  test("tabs count as one level each", () => {
    assert.equal(reindent("a\n\tb\n\t\tc", "2"), "a\n  b\n    c");
  });
  test("blank lines lose their spaces; code without indentation is unchanged", () => {
    assert.equal(reindent("a\n    \n  b", "4"), "a\n\n    b");
    assert.equal(reindent("SELECT 1;", "tab"), "SELECT 1;");
  });
});

describe("a new line's indentation", () => {
  test("that of the line it's made from, up to the caret", () => {
    assert.equal(lineIndent("a\n    b", 7), "    ");
    assert.equal(lineIndent("a\n\t\tb", 5), "\t\t");
    assert.equal(lineIndent("  ab", 1), " ");
    assert.equal(lineIndent("ab", 2), "");
    assert.equal(lineIndent("", 0), "");
  });
  test("code in a chat message is between ``` fences", () => {
    const text = "hi\n```js\n  x\n```\nafter";
    assert.equal(insideCodeFence(text, 2), false);
    assert.equal(insideCodeFence(text, text.indexOf("x")), true);
    assert.equal(insideCodeFence(text, text.length), false);
    assert.equal(insideCodeFence("```\nopen", 8), true);
    // On the opening fence's own line, not yet inside.
    assert.equal(insideCodeFence("```js", 5), false);
  });
});
