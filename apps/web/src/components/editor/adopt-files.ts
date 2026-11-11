import { useEffect } from "react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { adoptPageFiles } from "@/app/(app)/pages/[pageId]/file-actions";
import { blockLocksOf } from "@/components/editor/block-lock";
import { BASE_PATH } from "@/lib/base-path";
import { fileIdOf } from "@/lib/file-url";

// Attachments of other pages in this page's body (a block copied from
// there): a file is served to those who can open the page it was uploaded on,
// so everyone else got 404. When someone who can edit the page has it open,
// the server copies such files to this page (lib/file-copy.ts) and their
// blocks get the copy's URL, for everyone. The server says which files are
// the page's own already, and which it won't copy (this person can't open
// the file, the file type isn't allowed…): asked once per file while the
// page is open.

const DELAY_MS = 800;

type Editor = {
  prosemirrorView: EditorView | undefined;
  onChange: (callback: () => void) => () => void;
};

// Also this site's absolute URLs (HTML pasted from another tab), which become
// "/api/files/<id>" as the pages keep them.
function fileNodes(doc: PMNode): { pos: number; id: string; url: string }[] {
  const site = window.location.origin + BASE_PATH;
  const found: { pos: number; id: string; url: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.isInline) return false;
    const id = fileIdOf(node.attrs.url, site);
    if (id) found.push({ pos, id, url: node.attrs.url as string });
    return true;
  });
  return found;
}

// Inside a block locked against edits (lib/block-locks.ts), which the editor
// would refuse to change: left as it is.
function editLocked(doc: PMNode, pos: number, editor: object): boolean {
  const locks = blockLocksOf(editor);
  if (!locks || locks.size === 0) return false;
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const id = $pos.node(depth).attrs.id;
    if (typeof id === "string" && locks.get(id) === "edit") return true;
  }
  const id = doc.nodeAt(pos)?.attrs.id;
  return typeof id === "string" && locks.get(id) === "edit";
}

export function useAdoptFiles(editor: Editor, provider: HocuspocusProvider, pageId: string, readOnly: boolean) {
  useEffect(() => {
    if (readOnly) return;
    // File id → the URL the page should use; null: leave it.
    const known = new Map<string, string | null>();
    const asking = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const apply = () => {
      const view = editor.prosemirrorView;
      if (!view) return;
      const { state } = view;
      const tr = state.tr;
      for (const { pos, id, url: current } of fileNodes(state.doc)) {
        const url = known.get(id);
        if (!url || url === current || editLocked(state.doc, pos, editor)) continue;
        const node = state.doc.nodeAt(pos);
        if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, url });
      }
      if (tr.docChanged) view.dispatch(tr);
    };

    const check = async () => {
      if (stopped || !provider.isSynced) return;
      const view = editor.prosemirrorView;
      if (!view) return;
      const ids = [...new Set(fileNodes(view.state.doc).map((f) => f.id))];
      const ask = ids.filter((id) => !known.has(id) && !asking.has(id));
      if (ask.length > 0) {
        for (const id of ask) asking.add(id);
        try {
          const adopted = await adoptPageFiles(pageId, ask);
          for (const id of ask) known.set(id, adopted[id] ?? null);
        } catch {
          // Offline, or the server restarting: asked again on a later change.
        } finally {
          for (const id of ask) asking.delete(id);
        }
      }
      if (!stopped) apply();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), DELAY_MS);
    };

    schedule();
    const off = editor.onChange(schedule);
    provider.on("synced", schedule);
    return () => {
      stopped = true;
      clearTimeout(timer);
      off();
      provider.off("synced", schedule);
    };
  }, [editor, provider, pageId, readOnly]);
}
