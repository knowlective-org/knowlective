// The rule behind components/editor/sync-guard.ts (no dependencies, so it can
// be unit tested).
//
// The editor (ProseMirror) and the shared document (Yjs) should hold the same
// blocks. If a remote change ever fails to reach the editor, the editor still
// shows blocks that others have deleted, and its next edit writes its whole
// content back: y-prosemirror inserts those blocks again as new ones (new
// Yjs items), so a deleted block comes back, once per such tab. This finds
// the blocks that show it: ones the shared document once had and has no
// longer, still in the editor before and after this person's change (so not
// ones they just removed or pasted back themselves).

export function staleBlockIds(
  // Block ids in the editor before this person's change, and after it.
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  // Block ids in the shared document now, and ever seen in it.
  shared: ReadonlySet<string>,
  everShared: ReadonlySet<string>,
): string[] {
  const stale: string[] = [];
  for (const id of before) {
    if (after.has(id) && !shared.has(id) && everShared.has(id)) stale.push(id);
  }
  return stale;
}
