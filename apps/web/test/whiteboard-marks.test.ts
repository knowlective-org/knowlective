import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { ITEM_COLORS, readItems, whiteboardMap } from "../src/lib/whiteboard";
import {
  TEXT_COLORS,
  applyStyle,
  changedRange,
  decodeStyle,
  encodeStyle,
  readMarks,
  remapMarks,
  styleOf,
  styledRuns,
  toggleFlag,
} from "../src/lib/whiteboard-marks";
import { parseRichTextAt } from "../src/components/whiteboard/rich-text";
import { planWhiteboardChange } from "../src/lib/whiteboard-ops";

// Styles on parts of a whiteboard text (lib/whiteboard-marks.ts).
//   pnpm --filter web test:unit

describe("whiteboard text styles", () => {
  test("stored styles are checked: kept within the text, unknown values dropped, overlaps resolved", () => {
    assert.deepEqual(
      readMarks(
        [
          { from: 0, to: 3, bold: true },
          { from: 2, to: 99, italic: true, color: "red" },
          { from: 1, to: 2, color: "javascript:alert(1)" },
          { from: "0", to: 2, bold: true },
          { from: 4, to: 5, bold: "yes", strike: true },
          null,
          "x",
        ],
        6,
      ),
      [
        { from: 0, to: 2, bold: true },
        { from: 2, to: 4, italic: true, color: "red" },
        { from: 4, to: 5, strike: true },
        { from: 5, to: 6, italic: true, color: "red" },
      ],
    );
    assert.deepEqual(readMarks("not a list", 5), []);
    assert.deepEqual(readMarks([{ from: 0, to: 3, bold: true }], 0), []);
  });

  test("the text in runs of one style, and the style a range has in common", () => {
    const marks = [{ from: 0, to: 4, bold: true as const }, { from: 4, to: 8, bold: true as const, italic: true as const }];
    assert.deepEqual(styledRuns("boldboth rest", marks), [
      { text: "bold", style: { bold: true } },
      { text: "both", style: { bold: true, italic: true } },
      { text: " rest", style: null },
    ]);
    assert.deepEqual(styledRuns("boldboth rest", marks, 2, 6), [
      { text: "ld", style: { bold: true } },
      { text: "bo", style: { bold: true, italic: true } },
    ]);
    assert.deepEqual(styleOf(marks, 13, 0, 8), { bold: true });
    assert.deepEqual(styleOf(marks, 13, 0, 9), {});
    // At a caret: the character before it (what typing there gets).
    assert.deepEqual(styleOf(marks, 13, 6, 6), { bold: true, italic: true });
  });

  test("a style is turned on for a range, or off when all of it has it; colors are set or cleared", () => {
    let marks = toggleFlag([], 10, 2, 5, "bold");
    assert.deepEqual(marks, [{ from: 2, to: 5, bold: true }]);
    // Part of it already bold: all of it becomes bold.
    marks = toggleFlag(marks, 10, 0, 5, "bold");
    assert.deepEqual(marks, [{ from: 0, to: 5, bold: true }]);
    marks = toggleFlag(marks, 10, 1, 3, "bold");
    assert.deepEqual(marks, [{ from: 0, to: 1, bold: true }, { from: 3, to: 5, bold: true }]);
    marks = applyStyle(marks, 10, 0, 10, { color: "blue" });
    assert.deepEqual(marks, [
      { from: 0, to: 1, bold: true, color: "blue" },
      { from: 1, to: 3, color: "blue" },
      { from: 3, to: 5, bold: true, color: "blue" },
      { from: 5, to: 10, color: "blue" },
    ]);
    assert.deepEqual(applyStyle(marks, 10, 0, 10, { color: null, bold: false }), []);
  });

  test("styles follow a changed text: kept on the words, typed text takes the style before it", () => {
    const marks = [{ from: 4, to: 8, bold: true as const }];
    assert.deepEqual(changedRange("one two", "one three"), { from: 5, removed: 2, inserted: 4 });
    // Typed at the end of the bold word: bold too.
    assert.deepEqual(remapMarks("say this now", "say thisss now", marks), [{ from: 4, to: 10, bold: true }]);
    // Typed before it: moved along.
    assert.deepEqual(remapMarks("say this now", "I say this now", marks), [{ from: 6, to: 10, bold: true }]);
    // A list made of the lines: each line's styles stay on its words.
    assert.deepEqual(
      remapMarks("milk\neggs", "- milk\n- eggs", [{ from: 0, to: 4, bold: true }, { from: 5, to: 9, italic: true }], true),
      [{ from: 2, to: 6, bold: true }, { from: 9, to: 13, italic: true }],
    );
    assert.deepEqual(remapMarks("abc", "", marks), []);
  });

  test("a style in an attribute and back; anything else read as nothing", () => {
    const style = { bold: true as const, strike: true as const, color: "green" as const };
    assert.equal(encodeStyle(style), "b s c:green");
    assert.deepEqual(decodeStyle("b s c:green"), style);
    assert.equal(decodeStyle("x c:url(a)"), null);
  });

  test("where list items' words are in the text", () => {
    assert.deepEqual(parseRichTextAt("Title\n- one\n2. two"), [
      { kind: "text", span: { from: 0, to: 5 } },
      { kind: "bullet", items: [{ from: 8, to: 11 }] },
      { kind: "number", start: 2, items: [{ from: 15, to: 18 }] },
    ]);
  });

  test("items read their styles; text written through the API drops them", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const item = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ type: "sticky", x: 0, y: 0, w: 100, h: 100, text: "hello", textMarks: [{ from: 0, to: 5, bold: true }] })) {
        item.set(k, v);
      }
      whiteboardMap(doc).set("a", item);
    });
    assert.deepEqual(readItems(doc)[0].textMarks, [{ from: 0, to: 5, bold: true }]);
    const plan = planWhiteboardChange(doc, { update: [{ id: "a", text: "bye" }] }, () => "n");
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.ops.set[0].fields, { text: "bye", textMarks: null });
  });

  test("every text color has a contrast of at least 4.5:1 on every item color (globals.css)", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const hex = (name: string) => {
      const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      assert.ok(match, `--${name} is a 6-digit hex color`);
      return match[1];
    };
    const luminance = (color: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(color.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // Transparent boxes and connector labels show the board under them.
    const backgrounds = [...ITEM_COLORS.filter((c) => c !== "transparent").map((c) => `color-wb-${c}`), "color-wb-board"];
    for (const text of [...TEXT_COLORS.map((c) => `color-wb-text-${c}`), "color-wb-ink"]) {
      for (const bg of backgrounds) {
        const ratio = contrast(hex(text), hex(bg));
        assert.ok(ratio >= 4.5, `${text} on ${bg}: ${ratio.toFixed(2)}`);
      }
    }
  });
});
