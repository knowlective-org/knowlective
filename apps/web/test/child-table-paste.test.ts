import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type PasteRow, optionForText, pastedPropertyValue, planTablePaste } from "../src/lib/child-table-paste";
import type { PropertyColumn } from "../src/lib/page-property-types";

const status: PropertyColumn = {
  id: "status",
  type: "SELECT",
  name: "Status",
  options: [
    { id: "o1", name: "未着手", color: "" },
    { id: "o2", name: "Done", color: "" },
  ],
};
const due: PropertyColumn = { id: "due", type: "DATE", name: "Due", options: [] };
const note: PropertyColumn = { id: "note", type: "TEXT", name: "Note", options: [] };
const memo: PropertyColumn = { id: "memo", type: "LONG_TEXT", name: "Memo", options: [] };
const owner: PropertyColumn = { id: "owner", type: "USER", name: "Owner", options: [] };
const secret: PropertyColumn = { id: "secret", type: "MASKED", name: "Secret", options: [] };
const people = [
  { id: "u1", name: "山田 花子" },
  { id: "u2", name: "Sato" },
  { id: "u3", name: "sato" },
];

describe("child table paste", () => {
  test("options and people are chosen by name; others aren't values", () => {
    assert.equal(optionForText(status.options, " 未着手 ")?.id, "o1");
    assert.equal(optionForText(status.options, "ＤＯＮＥ")?.id, "o2");
    assert.equal(optionForText(status.options, "保留"), null);
    assert.equal(pastedPropertyValue(status, "Done\r\n", people), "o2");
    assert.equal(pastedPropertyValue(status, "保留", people), null);
    assert.equal(pastedPropertyValue(status, "", people), "");
    assert.equal(pastedPropertyValue(owner, "山田 花子", people), "u1");
    // Exact first; loosely, only when one fits.
    assert.equal(pastedPropertyValue(owner, "Sato", people), "u2");
    assert.equal(pastedPropertyValue(owner, "SATO", people), null);
    // An id isn't a name.
    assert.equal(pastedPropertyValue(owner, "u1", people), null);
  });

  test("dates, text and masked values", () => {
    assert.equal(pastedPropertyValue(due, "2026/12/1", people), "2026-12-01");
    assert.equal(pastedPropertyValue(due, "2026年2月30日", people), null);
    assert.equal(pastedPropertyValue(note, "一行目\n二行目", people), "一行目 二行目");
    assert.equal(pastedPropertyValue(memo, "一行目\r\n二行目", people), "一行目\n二行目");
    assert.equal(pastedPropertyValue(note, "あ".repeat(2001), people), null);
    assert.equal(pastedPropertyValue(secret, "平文", people), null);
  });

  test("a table fills from the cell pasted into; what can't be is left out", () => {
    const rows: PasteRow[] = [
      { id: "p1", canEdit: true, values: { status: "o1" } },
      { id: "p2", canEdit: false, values: {} },
      { id: "p3", canEdit: true, values: {} },
    ];
    const plan = planTablePaste({
      pasted: [
        ["Done", "2026-01-02", "x"],
        ["未着手", "2026-01-03", "y"],
        ["保留", "いつか", "z"],
        ["未着手", "", ""],
      ],
      at: { r: 0, c: 1 },
      rows,
      columns: [null, status, due],
      people,
    });
    assert.deepEqual(plan.changes, [
      { pageId: "p1", columnId: "status", value: "o2" },
      { pageId: "p1", columnId: "due", value: "2026-01-02" },
    ]);
    // Row 2 not editable (2), row 3's two values aren't ones.
    assert.equal(plan.skipped, 4);
    // A column and a row beyond the table.
    assert.equal(plan.cut, true);
  });

  test("the title and built-in columns aren't pasted into; unchanged values aren't sent", () => {
    const plan = planTablePaste({
      pasted: [["新しいタイトル", "未着手"]],
      at: { r: 0, c: 0 },
      rows: [{ id: "p1", canEdit: true, values: { status: "o1" } }],
      columns: [null, status],
      people,
    });
    assert.deepEqual(plan, { changes: [], skipped: 1, cut: false });
  });

  test("one value fills the selected cells", () => {
    const plan = planTablePaste({
      pasted: [["Done"]],
      at: { r: 0, c: 1 },
      fill: { rows: 2, columns: 1 },
      rows: [
        { id: "p1", canEdit: true, values: {} },
        { id: "p2", canEdit: true, values: {} },
      ],
      columns: [null, status],
      people,
    });
    assert.deepEqual(
      plan.changes.map((c) => c.pageId),
      ["p1", "p2"],
    );
  });
});
