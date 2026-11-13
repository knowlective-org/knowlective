import { createExtension } from "@blocknote/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { staleBlockIds } from "@/lib/sync-guard";

// Keeps an editor that has fallen out of step with the shared document from
// writing its stale content back (the rule: lib/sync-guard.ts).
//
// y-prosemirror writes the editor's whole document to Yjs after each change
// made here (updateYFragment). If a remote change never reached this editor
// (seen with tabs left open a long time: issue #41), blocks others deleted
// are still here, and that write inserts them again as new blocks, in every
// such tab: a deleted block comes back, multiplied. So right before the
// write, the editor is checked against the shared document; if it shows
// blocks the document has lost, the write is skipped and the editor is
// redrawn from the document instead (the change being made is lost). The
// same check runs when the tab comes back into view.

const BLOCK = "blockContainer";

// y-prosemirror's binding (not exported as a type). Its methods are internal
// but stable across 1.x.
type Binding = {
  type: SharedElement;
  prosemirrorView: { state: EditorState } | null;
  _prosemirrorChanged: (doc: PMNode) => void;
  _forceRerender: () => void;
};
type SharedElement = {
  toArray?: () => unknown[];
  nodeName?: string;
  getAttribute?: (name: string) => unknown;
  toDelta?: unknown;
  observeDeep: (f: (events: { target: SharedElement }[]) => void) => void;
  unobserveDeep: (f: (events: { target: SharedElement }[]) => void) => void;
};

// The doc before the latest change (an appended transaction keeps its root's).
const beforeKey = new PluginKey<PMNode>("knowlective-sync-guard");

// Block ids ever seen in each binding's shared document.
const seen = new WeakMap<Binding, Set<string>>();

function editorIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === BLOCK && typeof node.attrs.id === "string") ids.add(node.attrs.id);
    return !node.isTextblock && !node.isInline;
  });
  return ids;
}

// The block ids in a shared element and below it (text has none).
function sharedIds(el: SharedElement, ids = new Set<string>()): Set<string> {
  if (typeof el.toDelta === "function") return ids;
  if (el.nodeName === BLOCK) {
    const id = el.getAttribute?.("id");
    if (typeof id === "string") ids.add(id);
  }
  for (const child of el.toArray?.() ?? []) {
    if (child && typeof child === "object" && "toArray" in child) sharedIds(child as SharedElement, ids);
  }
  return ids;
}

function bindingOf(state: EditorState): Binding | null {
  const plugin = state.plugins.find((p) => (p as unknown as { key: string }).key === "y-sync$");
  return (plugin?.getState(state) as { binding?: Binding } | undefined)?.binding ?? null;
}

function stale(binding: Binding, before: PMNode, after: PMNode): string[] {
  return staleBlockIds(editorIds(before), editorIds(after), sharedIds(binding.type), seen.get(binding) ?? new Set());
}

function redraw(binding: Binding, ids: string[]) {
  console.warn(`Editor out of step with the shared document (${ids.length} deleted block(s) still shown): redrawn from it`);
  // Outside the write in progress (y-prosemirror skips nested syncs).
  queueMicrotask(() => {
    if (binding.prosemirrorView) binding._forceRerender();
  });
}

// Checks every write of this binding (once per binding: it outlives remounts).
function guardWrites(binding: Binding) {
  if (seen.has(binding)) return;
  seen.set(binding, sharedIds(binding.type));
  const write = binding._prosemirrorChanged;
  binding._prosemirrorChanged = function (this: Binding, doc: PMNode) {
    const before = this.prosemirrorView ? beforeKey.getState(this.prosemirrorView.state) : undefined;
    if (before) {
      const ids = stale(this, before, doc);
      if (ids.length > 0) {
        redraw(this, ids);
        return;
      }
    }
    write.call(this, doc);
  };
}

function syncGuardPlugin() {
  return new Plugin<PMNode>({
    key: beforeKey,
    state: {
      init: (_, state) => state.doc,
      apply: (tr, before, oldState) => (tr.getMeta("appendedTransaction") ? before : oldState.doc),
    },
    view(view) {
      const binding = bindingOf(view.state);
      if (!binding) return {};
      guardWrites(binding);
      const ever = seen.get(binding)!;
      // Remember every block the shared document gets (text changes have none).
      const observer = (events: { target: SharedElement }[]) => {
        for (const e of events) sharedIds(e.target, ever);
      };
      binding.type.observeDeep(observer);
      const check = () => {
        if (document.visibilityState !== "visible" || !binding.prosemirrorView) return;
        const doc = view.state.doc;
        const ids = stale(binding, doc, doc);
        if (ids.length > 0) redraw(binding, ids);
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("focus", check);
      return {
        destroy: () => {
          binding.type.unobserveDeep(observer);
          document.removeEventListener("visibilitychange", check);
          window.removeEventListener("focus", check);
        },
      };
    },
  });
}

export function syncGuardExtension() {
  return createExtension(() => ({ key: "knowlective-sync-guard", prosemirrorPlugins: [syncGuardPlugin()] }))();
}
