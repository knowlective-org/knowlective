import assert from "node:assert/strict";
import { test } from "node:test";
import { sortChildPages } from "../src/lib/child-sort";

// The order of the child page list.
//   pnpm --filter web test:unit

const page = (id: string, parentId: string, title: string, createdAt: string, updatedAt = createdAt) => ({ id, parentId, title, createdAt, updatedAt });
const pages = [
  page("b", "root", "Banana", "2026-01-02T00:00:00Z", "2026-03-01T00:00:00Z"),
  page("a", "root", "apple", "2026-01-03T00:00:00Z", "2026-02-01T00:00:00Z"),
  page("b2", "b", "zeta", "2026-01-04T00:00:00Z"),
  page("b1", "b", "", "2026-01-05T00:00:00Z"),
  page("c", "root", "Cherry", "2026-01-01T00:00:00Z", ""),
];
const ids = (list: { id: string; parentId: string }[], parent: string) => list.filter((p) => p.parentId === parent).map((p) => p.id);
const show = (t: string) => t || "Untitled";
const collator = new Intl.Collator("en");

test("the pages' own order without a sort, or with a key the list doesn't have", () => {
  assert.equal(sortChildPages(pages, "", show, collator.compare), pages);
  assert.equal(sortChildPages(pages, "col123:asc", show, collator.compare), pages);
  assert.equal(sortChildPages(pages, "title:sideways", show, collator.compare), pages);
});

test("by title, among siblings, empty titles as shown", () => {
  const sorted = sortChildPages(pages, "title:asc", show, collator.compare);
  assert.deepEqual(ids(sorted, "root"), ["a", "b", "c"]);
  assert.deepEqual(ids(sorted, "b"), ["b1", "b2"]); // "Untitled" < "zeta"
  assert.deepEqual(ids(sortChildPages(pages, "title:desc", show, collator.compare), "root"), ["c", "b", "a"]);
});

test("by creation and by last change; unknown times last either way", () => {
  assert.deepEqual(ids(sortChildPages(pages, "createdAt:asc", show, collator.compare), "root"), ["c", "b", "a"]);
  assert.deepEqual(ids(sortChildPages(pages, "updatedAt:desc", show, collator.compare), "root"), ["b", "a", "c"]);
  assert.deepEqual(ids(sortChildPages(pages, "updatedAt:asc", show, collator.compare), "root"), ["a", "b", "c"]);
});
