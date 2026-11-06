import { createExtension } from "@blocknote/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type * as Y from "yjs";
import { BLOCK_LOCKS_FIELD, type BlockLock, isBlockLock } from "@/lib/block-locks";

// Block locks in the editor (the rules: lib/block-locks.ts). Every change this
// person makes is checked against them before it applies: one that removes a
// locked block, or changes an "edit"-locked one (with the blocks nested in
// it), is refused whole and a notice says why. Moving a block keeps it (same
// id), so it's allowed. Changes from others (Yjs) are applied as they are:
// their editor checked them. An "edit"-locked block is also not editable in
// the page (contenteditable="false"), so typing (and an IME) never reaches it.

type Text = { label: (lock: BlockLock) => string; blocked: (lock: BlockLock) => void };

const lockKey = new PluginKey<DecorationSet>("knowlective-block-lock");

// Each editor's locks, for the ⋮⋮ menu (block-type-menu.tsx).
const lockMaps = new WeakMap<object, Y.Map<unknown>>();

export function blockLocksOf(editor: object): Y.Map<unknown> | undefined {
  return lockMaps.get(editor);
}

export function blockLockOf(editor: object, blockId: string): BlockLock | null {
  const lock = lockMaps.get(editor)?.get(blockId);
  return isBlockLock(lock) ? lock : null;
}

// Sets (null: removes) the lock of the blocks, in one change for everyone.
export function setBlockLocks(editor: object, blockIds: string[], lock: BlockLock | null) {
  const locks = lockMaps.get(editor);
  if (!locks) return;
  const apply = () => {
    for (const id of blockIds) {
      if (lock) locks.set(id, lock);
      else locks.delete(id);
    }
  };
  if (locks.doc) locks.doc.transact(apply);
  else apply();
}

type Found = Map<string, { node: PMNode; pos: number; lock: BlockLock }>;

// The locked blocks in the document (blocks, columns and the extended
// table's parts carry an id; their text doesn't).
function findLocked(doc: PMNode, locks: Y.Map<unknown>): Found {
  const found: Found = new Map();
  if (locks.size === 0) return found;
  doc.descendants((node, pos) => {
    if (node.isInline) return false;
    const id = node.attrs.id;
    if (typeof id === "string") {
      const lock = locks.get(id);
      if (isBlockLock(lock)) found.set(id, { node, pos, lock });
    }
    return true;
  });
  return found;
}

// Why a change can't apply (the lock of the block it would remove or change),
// or null if it can.
function lockBreach(before: Found, after: Found): BlockLock | null {
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) return was.lock;
    if (was.lock === "edit" && !now.node.eq(was.node)) return "edit";
  }
  return null;
}

function decorations(doc: PMNode, locks: Y.Map<unknown>, text: Text): DecorationSet {
  const found = findLocked(doc, locks);
  if (found.size === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    [...found.values()].map(({ node, pos, lock }) =>
      Decoration.node(pos, pos + node.nodeSize, {
        class: "kn-block-locked",
        "data-lock": lock,
        "data-lock-label": text.label(lock),
        ...(lock === "edit" ? { contenteditable: "false" } : {}),
      }),
    ),
  );
}

function blockLockPlugin(locks: Y.Map<unknown>, text: Text) {
  return new Plugin<DecorationSet>({
    key: lockKey,
    state: {
      init: (_, state) => decorations(state.doc, locks, text),
      apply: (tr, old, _oldState, state) =>
        tr.docChanged || tr.getMeta(lockKey) ? decorations(state.doc, locks, text) : old,
    },
    props: {
      decorations: (state) => lockKey.getState(state),
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta("y-sync$")) return true;
      const before = findLocked(state.doc, locks);
      if (before.size === 0) return true;
      const breach = lockBreach(before, findLocked(tr.doc, locks));
      if (!breach) return true;
      text.blocked(breach);
      return false;
    },
    // Locks set or removed (here or by someone else): redraw the marks.
    view(view) {
      const changed = () =>
        queueMicrotask(() => {
          if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(lockKey, true));
        });
      locks.observe(changed);
      return { destroy: () => locks.unobserve(changed) };
    },
  });
}

// The extension for one page's editor: `doc` is the page's Yjs document.
export function blockLockExtension(doc: Y.Doc, text: Text) {
  const locks = doc.getMap<unknown>(BLOCK_LOCKS_FIELD);
  return createExtension(({ editor }) => {
    lockMaps.set(editor, locks);
    return { key: "knowlective-block-lock", prosemirrorPlugins: [blockLockPlugin(locks, text)] };
  })();
}
