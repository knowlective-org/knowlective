import { createExtension } from "@blocknote/core";
import { NodeSelection, Plugin, PluginKey, Selection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Blocks of ours that are small apps of their own (child page tables,
// boards, calendars, a whiteboard, a chat, …): a click in one is for what
// was clicked (a card, a cell, a button), not for the editor. ProseMirror
// would otherwise take the click as selecting the whole block (a node
// selection, drawn around it), and the first click on a card would only do
// that. The block can still be selected, moved or deleted with its ⋮⋮
// handle. BlockNote's own blocks (images, files, …) keep their selection:
// their toolbars come with it.
export const SELF_HANDLED_BLOCKS = new Set([
  "childPages",
  "childTable",
  "childBoard",
  "childCalendar",
  "linkPreview",
  "mermaid",
  "pdf",
  "videoEmbed",
  "chat",
  "whiteboard",
  "toc",
  "maskedText",
]);

// The content of such a block the event is in, or null.
function selfHandled(view: EditorView, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const content = target.closest<HTMLElement>(".bn-block-content[data-content-type]");
  if (!content || !view.dom.contains(content)) return null;
  return SELF_HANDLED_BLOCKS.has(content.dataset.contentType ?? "") ? content : null;
}

const key = new PluginKey("knowlective-block-clicks");

// Whether a node selection would select such a block (BlockNote selects its
// block container, or the content node).
function selectsSelfHandled(tr: Transaction): boolean {
  const { selection } = tr;
  if (!(selection instanceof NodeSelection)) return false;
  const node = selection.node.type.name === "blockContainer" ? selection.node.firstChild : selection.node;
  return !!node && SELF_HANDLED_BLOCKS.has(node.type.name);
}

function blockClicksPlugin() {
  // From pressing in such a block until a moment after letting go: the
  // browser's selection moving into it (it isn't editable) would make
  // ProseMirror select the whole block, which is turned down then.
  let pressedUntil = 0;
  const pressing = () => pressedUntil === Infinity || Date.now() < pressedUntil;
  return new Plugin({
    key,
    filterTransaction: (tr) => !(pressing() && tr.selectionSet && !tr.docChanged && selectsSelfHandled(tr)),
    view: () => {
      const release = () => {
        if (pressedUntil === Infinity) pressedUntil = Date.now() + 500;
      };
      document.addEventListener("mouseup", release, true);
      document.addEventListener("touchend", release, true);
      return {
        destroy: () => {
          document.removeEventListener("mouseup", release, true);
          document.removeEventListener("touchend", release, true);
        },
      };
    },
    props: {
      handleDOMEvents: {
        // Handled here (true): ProseMirror doesn't start its own click, which
        // on release would select the block. The browser's default stays
        // (focus, inputs, text selection).
        mousedown: (view, event) => {
          if (!selfHandled(view, event.target)) return false;
          pressedUntil = Infinity;
          // A block selected as a whole (as one is right after it's put in)
          // stops being so: the selection goes to the text before it, else
          // after it (a page of that block alone has none: it stays).
          const { selection, doc } = view.state;
          if (selection instanceof NodeSelection) {
            const near = [Selection.findFrom(doc.resolve(selection.from), -1, true), Selection.findFrom(doc.resolve(selection.to), 1, true)].find(Boolean);
            if (near) view.dispatch(view.state.tr.setSelection(near));
          }
          return true;
        },
        touchstart: (view, event) => {
          if (selfHandled(view, event.target)) pressedUntil = Infinity;
          return false;
        },
      },
      // A click that still reaches the editor (a double click) on such a
      // block: not a selection of it.
      handleClickOn: (view, _pos, _node, _nodePos, event) => !!selfHandled(view, event.target),
      handleDoubleClickOn: (view, _pos, _node, _nodePos, event) => !!selfHandled(view, event.target),
      handleTripleClickOn: (view, _pos, _node, _nodePos, event) => !!selfHandled(view, event.target),
    },
  });
}

export function blockClicksExtension() {
  return createExtension(() => ({ key: "knowlective-block-clicks", prosemirrorPlugins: [blockClicksPlugin()] }))();
}
