import {
  SyntaxHighlightingExtension,
  createBlockSpec,
  createCodeBlock,
  createCodeBlockConfig,
  createCodeBlockSpec,
  createExtension,
  createPreCode,
  parsePreCode,
  parsePreCodeContent,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import type { EditorView } from "@tiptap/pm/view";
import { type IndentUnit, INDENT_UNITS, reindent } from "@/lib/reindent";
import { lineIndent } from "@/lib/auto-indent";
import { showNotice } from "../notice";
import { CODE_BLOCK_EXTRA_PROPS } from "./block-configs";
import { withOurLanguages } from "./code-languages";
import { formatCode, hasFormatter } from "./code-format";
import { type PreviewMode, PREVIEW_MODES, hasPreview, renderPreview } from "./code-preview";

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
//   indent is each viewer's own, remembered in the browser;
// - for HTML, Markdown, Mermaid and LaTeX, the result of the code below it or
//   in its place (the `preview` prop, chosen by an editor; code-preview.ts).
//
// Same type and props as BlockNote's (plus `preview`), so blocks written
// before keep their language. Built from BlockNote's own parts, as
// createCodeBlockSpec does.
const original = createCodeBlockSpec(CODE_BLOCK_OPTIONS);
const originalConfig = createCodeBlockConfig(CODE_BLOCK_OPTIONS);
const config = {
  ...originalConfig,
  propSchema: { ...originalConfig.propSchema, ...CODE_BLOCK_EXTRA_PROPS },
};
type Editor = Parameters<typeof createCodeBlock>[1];
type CodeBlockView = { id: string; props: { language: string; preview: string } };

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

// Enter keeps the line's indentation. Ahead of BlockNote's Enter, which
// adds a bare new line (and leaves the block on Enter at its end after two
// empty lines: an indented empty line at the end loses its indentation, so
// that still works).
const enterKeepsIndent = createExtension({
  key: "knowlective-code-enter-indent",
  runsBefore: ["code-block-keyboard-shortcuts"],
  keyboardShortcuts: {
    Enter: ({ editor }) => {
      const { selection } = editor.prosemirrorState;
      const { $from } = selection;
      if (!selection.empty || $from.parent.type.name !== "codeBlock") return false;
      const text = $from.parent.textContent;
      const caret = $from.parentOffset;
      const indent = lineIndent(text, caret);
      if (!indent) return false;
      const tiptap = editor._tiptapEditor;
      const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
      if (caret === text.length && text.slice(lineStart).trim() === "") {
        return tiptap.commands.command(({ tr }) => {
          tr.insertText("\n", $from.pos - (caret - lineStart), $from.pos);
          return true;
        });
      }
      return tiptap.commands.command(({ tr }) => {
        tr.insertText(`\n${indent}`);
        return true;
      });
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

// Code pasted into a code block takes the indent chosen in its picker (the
// same unit "Format" uses): each line keeps its level, in that unit. One
// line is pasted as it is. True when it was handled (the caret is in a code
// block's text, and there's text to paste).
export function pasteIntoCode(view: EditorView, text: string): boolean {
  const { $from } = view.state.selection;
  if ($from.parent.type.name !== "codeBlock" || !text) return false;
  const code = text.replace(/\r\n?/g, "\n");
  view.dispatch(view.state.tr.insertText(code.includes("\n") ? reindent(code, savedIndent()) : code).scrollIntoView());
  return true;
}

type CodeText = {
  indent: string;
  indent2: string;
  indent4: string;
  indentTab: string;
  format: string;
  formatTitle: string;
  reindentTitle: string;
  formatFailed: string;
  preview: string;
  previewNone: string;
  previewBelow: string;
  previewOnly: string;
  previewLabel: string;
  previewBadge: string;
  previewFailed: string;
  previewNavigated: string;
};

// Our text, put in BlockNote's dictionary by blockNoteDictionary().
const codeText = (editor: Editor) => (editor.dictionary as unknown as { knowlective_code: CodeText }).knowlective_code;

function codeOf(editor: Editor, id: string): { code: string; language: string } | null {
  const current = editor.getBlock(id);
  if (!current || current.type !== "codeBlock") return null;
  const code = (current.content as { type: string; text: string }[]).map((c) => (c.type === "text" ? c.text : "")).join("");
  return { code, language: String(current.props.language) };
}

function previewMode(block: CodeBlockView): PreviewMode {
  return (PREVIEW_MODES as string[]).includes(block.props.preview) ? (block.props.preview as PreviewMode) : "";
}

// The preview's picker (for the languages it can show), the indent picker
// and "Format", next to BlockNote's language picker (in its non-editable
// wrapper, so clicks don't reach the code).
function formatTools(block: CodeBlockView, editor: Editor): HTMLElement {
  const text = codeText(editor);
  const tools = document.createElement("div");
  tools.className = "knowlective-code-tools";
  tools.dataset.ui = "CodeBlock.tools";

  if (hasPreview(block.props.language)) {
    const preview = document.createElement("select");
    preview.dataset.ui = "CodeBlock.previewSelect";
    preview.setAttribute("aria-label", text.preview);
    const modes: Record<PreviewMode, string> = { "": text.previewNone, below: text.previewBelow, only: text.previewOnly };
    for (const mode of PREVIEW_MODES) preview.append(new Option(modes[mode], mode));
    preview.value = previewMode(block);
    preview.addEventListener("change", () => {
      editor.updateBlock(block.id, { props: { preview: preview.value } } as never);
    });
    tools.append(preview);
  }

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
    const current = codeOf(editor, block.id);
    if (!current) return;
    button.disabled = true;
    try {
      const formatted = await formatCode(current.code, current.language, indent.value as IndentUnit);
      if (formatted !== current.code) editor.updateBlock(block.id, { content: formatted } as never);
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

// Wait this long after the last keystroke before drawing the preview again.
const PREVIEW_DELAY_MS = 400;

// The preview under the code, drawn again as the code changes.
function previewArea(block: CodeBlockView, editor: Editor): { dom: HTMLElement; destroy: () => void } {
  const text = codeText(editor);
  const dom = document.createElement("div");
  dom.contentEditable = "false";
  dom.className = "knowlective-code-preview";
  dom.dataset.ui = "CodeBlock.preview";
  dom.setAttribute("role", "region");
  dom.setAttribute("aria-label", text.previewLabel);
  // A badge on its frame, so it doesn't read as part of the code.
  const badge = document.createElement("div");
  badge.className = "knowlective-code-preview-badge";
  badge.dataset.ui = "CodeBlock.previewBadge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = text.previewBadge;
  const output = document.createElement("div");
  output.className = "knowlective-code-preview-output";
  dom.append(badge, output);

  let shown: string | null = null;
  let undo = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drawing = Promise.resolve();
  let destroyed = false;
  const draw = () => {
    const current = codeOf(editor, block.id);
    if (destroyed || !current || current.code === shown) return;
    shown = current.code;
    // One drawing at a time, in order.
    drawing = drawing.then(async () => {
      if (destroyed) return;
      undo();
      undo = await renderPreview(
        output,
        block.props.language,
        current.code,
        editor,
        { label: text.previewLabel, failed: text.previewFailed, navigated: text.previewNavigated },
        showNotice,
      );
      if (destroyed) undo();
    });
  };
  // Once the block is in the document.
  setTimeout(draw, 0);
  const unsubscribe = editor.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(draw, PREVIEW_DELAY_MS);
  });
  return {
    dom,
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      unsubscribe?.();
      undo();
    },
  };
}

export const codeBlock = createBlockSpec(
  config,
  {
    // As createCodeBlockSpec's.
    meta: { code: true, defining: true, isolating: false, highlight: (block) => block.props.language },
    parse: (el) => parsePreCode(el),
    parseContent: (opts) => parsePreCodeContent(opts, "codeBlock"),
    render(block, editor) {
      // The picker throws on a language it doesn't list: "" ("``` ", and code
      // blocks from before the languages were added) or one from Markdown
      // (```foo). Those show as plain text; the block keeps its value until
      // another language is picked.
      const known = block.props.language in CODE_BLOCK_OPTIONS.supportedLanguages;
      const shown = known ? block : { ...block, props: { ...block.props, language: "text" } };
      const view = createCodeBlock(shown, editor, {
        selectedLanguage: shown.props.language,
        supportedLanguages: CODE_BLOCK_OPTIONS.supportedLanguages,
      });
      view.contentDOM.setAttribute("spellcheck", "false");
      // The language picker's wrapper (createCodeBlock in BlockNote).
      const header = view.dom.firstChild;
      const tools =
        editor.isEditable && header instanceof HTMLElement && header.contentEditable === "false"
          ? formatTools(block, editor)
          : null;
      if (tools) (header as HTMLElement).append(tools);
      const preview = previewMode(block) && hasPreview(block.props.language) ? previewArea(block, editor) : null;
      if (preview) view.dom.append(preview.dom);
      return {
        dom: view.dom,
        contentDOM: view.contentDOM,
        // The tools and the preview change on their own (a frame's height,
        // a diagram drawn): not the code.
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" &&
          (!!tools?.contains(mutation.target) || !!preview?.dom.contains(mutation.target)),
        destroy: () => {
          view.destroy();
          preview?.destroy();
        },
      };
    },
    toExternalHTML: (block) => createPreCode(block),
  },
  [...(original.extensions ?? []), selectAllInCode, enterKeepsIndent, syntaxHighlighter],
)();
