// The order of a child page list (the block, and the list written out for it
// in the Markdown / PDF export and the API): the pages' own order, or by
// title, creation or last change. The sort is "<key>:asc" / "<key>:desc", as
// the child page table's; any other key (a column, from a board's or table's
// sort) keeps the pages' own order. Pages are sorted among their siblings: a
// stable sort of the whole list keeps each parent's children in that order.
//
// Dependency-free: unit-tested (test/child-sort.test.ts).

export const CHILD_LIST_SORT_KEYS = ["title", "createdAt", "updatedAt"] as const;

type Sortable = { title: string; createdAt: string; updatedAt: string };

export function sortChildPages<T extends Sortable>(
  pages: T[],
  sort: string,
  // The title as shown (an empty one is "Untitled" in the viewer's language).
  displayTitle: (title: string) => string,
  compareText: (a: string, b: string) => number,
): T[] {
  const [key, dir] = sort.split(":");
  if (!(CHILD_LIST_SORT_KEYS as readonly string[]).includes(key) || (dir !== "asc" && dir !== "desc")) return pages;
  const sign = dir === "asc" ? 1 : -1;
  const value = (page: T): string | number | null => {
    if (key === "title") return displayTitle(page.title);
    const time = Date.parse(key === "createdAt" ? page.createdAt : page.updatedAt);
    return Number.isNaN(time) ? null : time;
  };
  return [...pages].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    // Unknown times always last.
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : compareText(String(x), String(y));
    return cmp * sign;
  });
}
