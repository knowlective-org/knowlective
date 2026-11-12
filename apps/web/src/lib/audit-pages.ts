// Audit log entries that name pages by their titles, and which pages (no
// dependencies, so it can be tested in Node). The admin console shows such an
// entry only to those who can open every page it names: a site admin may
// know a knowledge root is there (its name), not what's in it.

// The actions whose summary has page titles in it, and the keys of their
// detail holding those pages' ids. Knowledge roots' names (root.create,
// root.delete, a move's destination root) aren't counted: those may be known.
const PAGE_KEYS: Record<string, readonly string[]> = {
  "page.move": ["pageId", "fromParentId", "toParentId"],
  "page.restore.move": ["pageId", "fromParentId", "toParentId"],
  "page.lock": ["pageId"],
  "page.unlock": ["pageId"],
  "page.version.mask": ["pageId"],
  "page.grant.set": ["pageId"],
  "page.grant.remove": ["pageId"],
  "page.public.set": ["pageId"],
  "page.public.remove": ["pageId"],
  "landing-page.settings": ["pageId"],
};

// The ids of the pages the entry names, or null if it names none.
export function auditPageIds(action: string, detail: unknown): string[] | null {
  const keys = PAGE_KEYS[action];
  if (!keys) return null;
  const d = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
  return [...new Set(keys.map((k) => d[k]).filter((v): v is string => typeof v === "string" && v !== ""))];
}
