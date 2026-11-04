import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type CellReader, matchesFilters, normalizeView } from "../src/lib/table-view";

// A person's filters and sort for a child page table (lib/table-view.ts). The
// view is sent by the client before it's saved to the account.
//   pnpm --filter web test:unit

const row = (cells: Record<string, { text?: string; value?: string; date?: string }>): CellReader => ({
  text: (key) => cells[key]?.text ?? "",
  value: (key) => cells[key]?.value ?? "",
  date: (key) => cells[key]?.date ?? "",
});

describe("child page table views", () => {
  test("a view from the client is checked and cleaned", () => {
    assert.deepEqual(normalizeView({ sort: "title:asc", filters: { title: { kind: "text", q: "  議事録 " } } }), {
      sort: "title:asc",
      filters: { title: { kind: "text", q: "議事録" } },
    });
    // Conditions that match everything are dropped; duplicates merged.
    assert.deepEqual(
      normalizeView({
        sort: null,
        filters: { a: { kind: "text", q: " " }, b: { kind: "values", ids: ["x", "x", ""] }, c: { kind: "dates", from: "", to: "" } },
      }),
      { sort: null, filters: { b: { kind: "values", ids: ["x", ""] } } },
    );
    assert.equal(normalizeView(null), null);
    assert.equal(normalizeView({ sort: "title:sideways" }), null);
    assert.equal(normalizeView({ sort: "<script>:asc" }), null);
    assert.equal(normalizeView({ filters: { "a b": { kind: "text", q: "x" } } }), null);
    assert.equal(normalizeView({ filters: { a: { kind: "regex", q: ".*" } } }), null);
    assert.equal(normalizeView({ filters: { a: { kind: "dates", from: "yesterday", to: "" } } }), null);
    assert.equal(normalizeView({ filters: { a: { kind: "text", q: "x".repeat(201) } } }), null);
    assert.equal(normalizeView({ filters: { a: { kind: "values", ids: ["ok", 1] } } }), null);
    assert.equal(normalizeView({ filters: [] }), null);
  });

  test("every condition must match; text matches every word, however typed", () => {
    const known = new Set(["title", "status", "due"]);
    const r = row({ title: { text: "ＡＢＣ 定例会議の議事録" }, status: { value: "done" }, due: { date: "2026-11-04" } });
    assert.ok(matchesFilters({ title: { kind: "text", q: "abc 議事録" } }, known, r));
    assert.ok(!matchesFilters({ title: { kind: "text", q: "abc 報告" } }, known, r));
    assert.ok(matchesFilters({ status: { kind: "values", ids: ["todo", "done"] } }, known, r));
    assert.ok(!matchesFilters({ status: { kind: "values", ids: ["todo"] }, title: { kind: "text", q: "abc" } }, known, r));
    assert.ok(matchesFilters({ due: { kind: "dates", from: "2026-11-01", to: "2026-11-04" } }, known, r));
    assert.ok(!matchesFilters({ due: { kind: "dates", from: "2026-11-05", to: "" } }, known, r));
  });

  test("empty cells: matched by the empty value, never by a date range", () => {
    const known = new Set(["status", "due"]);
    const r = row({});
    assert.ok(matchesFilters({ status: { kind: "values", ids: [""] } }, known, r));
    assert.ok(!matchesFilters({ due: { kind: "dates", from: "", to: "2026-12-31" } }, known, r));
  });

  test("a filter on a column that's gone is ignored", () => {
    assert.ok(matchesFilters({ deleted: { kind: "values", ids: ["x"] } }, new Set(["title"]), row({})));
  });
});
