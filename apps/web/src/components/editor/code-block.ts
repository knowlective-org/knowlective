import { createExtension, defaultBlockSpecs } from "@blocknote/core";

// BlockNote's code block with two changes for writing code:
// - no spellcheck: the browser underlines identifiers and keywords as typos;
// - Ctrl/Cmd+A with the cursor in a code block selects the block's code. Once
//   all of it is selected, the next press selects the whole page as usual.
//
// Same type and props as BlockNote's, so the server's schema
// (server/markdown-engine.mts, BlockNote's defaults) reads the same blocks.
const base = defaultBlockSpecs.codeBlock;

const selectAllInCode = createExtension({
  key: "knowlective-code-select-all",
  keyboardShortcuts: {
    "Mod-a": ({ editor }) => {
      const { $from, $to, from, to } = editor.prosemirrorState.selection;
      if ($from.parent.type.name !== "codeBlock" || !$from.sameParent($to)) return false;
      const start = $from.start();
      const end = $from.end();
      if (from === start && to === end) return false;
      return editor._tiptapEditor.commands.setTextSelection({ from: start, to: end });
    },
  },
});

export const codeBlock: typeof base = {
  ...base,
  implementation: {
    ...base.implementation,
    render(block, editor) {
      const view = base.implementation.render.call(this, block, editor);
      view.contentDOM?.setAttribute("spellcheck", "false");
      return view;
    },
  },
  extensions: [...(base.extensions ?? []), selectAllInCode],
};
