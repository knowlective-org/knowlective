import * as Y from "yjs";

// Block locks: kept in the page's Yjs document, next to the body, as a map
// from a block's id to its lock. Like the page lock, they prevent mistakes and
// aren't access control: anyone who can edit the page can lock and unlock.
// The editor enforces them (components/editor/block-lock.ts); the server
// refuses an API write that replaces a body with locked blocks.
//   "delete": the block stays (it can be edited and moved, not deleted)
//   "edit":   the block, with the blocks nested in it, stays as it is

export const BLOCK_LOCKS_FIELD = "blockLocks";

export type BlockLock = "delete" | "edit";

export const BLOCK_LOCKS: readonly BlockLock[] = ["delete", "edit"];

export function isBlockLock(value: unknown): value is BlockLock {
  return value === "delete" || value === "edit";
}

// The locks of blocks still in the body (a lock of a deleted block — say, by a
// version restore — is left in the map, and counts again if it comes back).
export function lockedBlockIds(doc: Y.Doc): Map<string, BlockLock> {
  const locks = doc.getMap<unknown>(BLOCK_LOCKS_FIELD);
  const found = new Map<string, BlockLock>();
  if (locks.size === 0) return found;
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      const id = child.getAttribute("id");
      const lock = typeof id === "string" ? locks.get(id) : undefined;
      if (typeof id === "string" && isBlockLock(lock)) found.set(id, lock);
      visit(child);
    }
  };
  visit(doc.getXmlFragment("blocknote"));
  return found;
}
