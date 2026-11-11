import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// Ctrl (Option on a Mac) while dragging a block by its ⋮⋮ handle copies it,
// as ProseMirror decides from the drop event's keys. A block dropped outside
// the text (in the margins, below the last block) reaches the editor as an
// event BlockNote makes again from the browser's (`new Event(type, event)`,
// SideMenu's dispatchSyntheticEvent), which has no keys, so it was always
// moved. The keys of the browser's own event, seen just before (window,
// capture), decide for such an event; for others ProseMirror's own rule stays.

const mac = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);

let copyKeyDown = false;
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const note = (event: DragEvent) => {
    if (!(event as DragEvent & { synthetic?: boolean }).synthetic) copyKeyDown = mac ? event.altKey : event.ctrlKey;
  };
  window.addEventListener("dragover", note, true);
  window.addEventListener("drop", note, true);
}

export const dragCopyExtension = createExtension(() => {
  listen();
  return {
    key: "knowlective-drag-copy",
    prosemirrorPlugins: [
      new Plugin({
        key: new PluginKey("knowlective-drag-copy"),
        props: {
          // undefined: ProseMirror's own rule (its event has the keys).
          dragCopies: (event) => ((event as DragEvent & { synthetic?: boolean }).synthetic ? copyKeyDown : undefined) as boolean,
        },
      }),
    ],
  };
});
