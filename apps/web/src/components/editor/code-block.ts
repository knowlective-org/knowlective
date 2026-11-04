import { createCodeBlockSpec, createExtension } from "@blocknote/core";
import { codeBlockOptions, syntaxHighlighter } from "@blocknote/code-block";

// The languages a code block can be set to (the picker at its top left), and
// syntax highlighting for them: @blocknote/code-block's (Shiki, loaded the
// first time a code block is shown). New blocks start as plain text, as
// before. The server's schema (server/markdown-engine.mts) uses the same
// options, so a Markdown ```python block gets its language there too.
export const CODE_BLOCK_OPTIONS = { ...codeBlockOptions, defaultLanguage: "text" };

// BlockNote's code block with these changes for writing code:
// - syntax highlighting by language (above);
// - no spellcheck: the browser underlines identifiers and keywords as typos;
// - Ctrl/Cmd+A with the cursor in a code block selects the block's code. Once
//   all of it is selected, the next press selects the whole page as usual.
//
// Same type and props as BlockNote's, so blocks written before keep their
// language.
const base = createCodeBlockSpec(CODE_BLOCK_OPTIONS);

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
      // The picker throws on a language it doesn't list: "" ("``` ", and code
      // blocks from before the languages were added) or one from Markdown
      // (```foo). Those show as plain text; the block keeps its value until
      // another language is picked.
      const known = block.props.language in CODE_BLOCK_OPTIONS.supportedLanguages;
      const shown = known ? block : { ...block, props: { ...block.props, language: "text" } };
      const view = base.implementation.render.call(this, shown, editor);
      view.contentDOM?.setAttribute("spellcheck", "false");
      return view;
    },
  },
  extensions: [...(base.extensions ?? []), selectAllInCode, syntaxHighlighter],
};
