import { SyntaxHighlightingExtension, createCodeBlockSpec, createExtension } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { type IndentUnit, INDENT_UNITS } from "@/lib/reindent";
import { showNotice } from "../notice";
import { withOurLanguages } from "./code-languages";
import { formatCode, hasFormatter } from "./code-format";

const CODE_BLOCK_OPTIONS = withOurLanguages(codeBlockOptions);

// The languages a code block can be set to (the picker at its top left;
// code-languages.ts), and syntax highlighting for them (Shiki,
// code-highlighter.ts, loaded the first time a code block is shown).
type CreateHighlighter = Parameters<typeof SyntaxHighlightingExtension>[0]["createHighlighter"];
const syntaxHighlighter = SyntaxHighlightingExtension({
  // The same highlighter type; BlockNote's is typed by its own copy of
  // @shikijs/types (an older patch version).
  createHighlighter: (() => import("./code-highlighter").then((m) => m.createCodeHighlighter())) as CreateHighlighter,
});

// BlockNote's code block with these changes for writing code:
// - syntax highlighting by language (above);
// - no spellcheck: the browser underlines identifiers and keywords as typos;
// - Ctrl/Cmd+A with the cursor in a code block selects the block's code. Once
//   all of it is selected, the next press selects the whole page as usual;
// - "Format" at the top right, with the indent to use (code-format.ts). The
//   indent is each viewer's own, remembered in the browser.
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

const INDENT_KEY = "knowlective-code-indent";

function savedIndent(): IndentUnit {
  try {
    const saved = window.localStorage.getItem(INDENT_KEY);
    return INDENT_UNITS.includes(saved as IndentUnit) ? (saved as IndentUnit) : "2";
  } catch {
    return "2";
  }
}

type CodeText = { indent: string; indent2: string; indent4: string; indentTab: string; format: string; formatTitle: string; reindentTitle: string; formatFailed: string };

// The indent picker and "Format", next to BlockNote's language picker (in
// its non-editable wrapper, so clicks don't reach the code).
function formatTools(block: { id: string; props: { language: string } }, editor: Parameters<typeof base.implementation.render>[1]): HTMLElement {
  // Our text, put in BlockNote's dictionary by blockNoteDictionary().
  const text = (editor.dictionary as unknown as { knowlective_code: CodeText }).knowlective_code;
  const tools = document.createElement("div");
  tools.className = "knowlective-code-tools";
  tools.dataset.ui = "CodeBlock.tools";

  const indent = document.createElement("select");
  indent.dataset.ui = "CodeBlock.indentSelect";
  indent.setAttribute("aria-label", text.indent);
  const names: Record<IndentUnit, string> = { "2": text.indent2, "4": text.indent4, tab: text.indentTab };
  for (const unit of INDENT_UNITS) indent.append(new Option(names[unit], unit));
  indent.value = savedIndent();
  indent.addEventListener("change", () => {
    try {
      window.localStorage.setItem(INDENT_KEY, indent.value);
    } catch {
      // Only for this time, then.
    }
  });

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.ui = "CodeBlock.formatButton";
  button.textContent = text.format;
  button.title = hasFormatter(block.props.language) ? text.formatTitle : text.reindentTitle;
  button.addEventListener("click", async () => {
    const current = editor.getBlock(block.id);
    if (!current || current.type !== "codeBlock") return;
    const code = (current.content as { type: string; text: string }[]).map((c) => (c.type === "text" ? c.text : "")).join("");
    button.disabled = true;
    try {
      const formatted = await formatCode(code, current.props.language as string, indent.value as IndentUnit);
      if (formatted !== code) editor.updateBlock(block.id, { content: formatted } as never);
    } catch (error) {
      console.warn("[code] formatting failed", error);
      showNotice(text.formatFailed);
    } finally {
      button.disabled = false;
    }
  });
  tools.append(indent, button);
  return tools;
}

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
      // The language picker's wrapper (createCodeBlock in BlockNote).
      const header = view.dom.firstChild;
      if (editor.isEditable && header instanceof HTMLElement && header.contentEditable === "false") {
        header.append(formatTools(block, editor));
      }
      return view;
    },
  },
  extensions: [...(base.extensions ?? []), selectAllInCode, syntaxHighlighter],
};
