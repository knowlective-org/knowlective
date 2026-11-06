import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reindent } from "../src/lib/reindent";

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
