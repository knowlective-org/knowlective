"use client";

import { type RefObject, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { MAX_TEXT_LENGTH } from "@/lib/whiteboard";
import {
  type StyleFlag,
  type StylePatch,
  type TextColor,
  type TextMark,
  type TextStyle,
  applyStyle,
  changedRange,
  decodeStyle,
  encodeStyle,
  marksFromStyles,
  remapMarks,
  styleOf,
  styledRuns,
  textStyleCss,
} from "@/lib/whiteboard-marks";
import { enterInList } from "./rich-text";

// The field a whiteboard text is edited in: the plain text, with styles on
// parts of it (lib/whiteboard-marks.ts). An element with contenteditable
// "plaintext-only", so the browser types, deletes and composes (IMEs) the
// text itself but never adds formatting; the styles are spans this file
// draws (`data-s`), and what it shows is read back after each change: the
// text and the style of each character. Line breaks, pastes, undo and the
// styles' keys are this file's. Uncontrolled while it's open, so someone
// else's edit doesn't move the caret (as the textarea before it).

export type TextEditorHandle = {
  // Bold, italic, underline or strike on or off for the selection, or a
  // color (null: the default). With nothing selected, for what's typed next.
  style: (change: { flag: StyleFlag } | { color: TextColor | null }) => void;
  // The text as it is in the document now (after an undo).
  reset: (text: string, marks: TextMark[]) => void;
};

export const textColorVar = (c: TextColor) => `var(--color-wb-text-${c})`;

type Model = { text: string; marks: TextMark[] };

function draw(el: HTMLElement, { text, marks }: Model) {
  el.replaceChildren();
  for (const run of styledRuns(text, marks)) {
    const span = document.createElement("span");
    if (run.style) {
      span.dataset.s = encodeStyle(run.style);
      Object.assign(span.style, textStyleCss(run.style, textColorVar));
    }
    span.textContent = run.text;
    el.append(span);
  }
  // A last empty line needs something to stand on.
  if (text === "" || text.endsWith("\n")) {
    const br = document.createElement("br");
    br.dataset.wbEnd = "";
    el.append(br);
  }
  el.toggleAttribute("data-empty", text === "");
}

// The characters in order: text nodes, and line breaks (<br>) other than the
// one that holds up a last empty line.
type Leaf = { node: Node; start: number; length: number };
function leaves(el: HTMLElement): Leaf[] {
  const out: Leaf[] = [];
  let at = 0;
  const walk = (parent: Node) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const length = (child as Text).data.length;
        out.push({ node: child, start: at, length });
        at += length;
      } else if (child instanceof HTMLBRElement) {
        if (child.hasAttribute("data-wb-end")) continue;
        out.push({ node: child, start: at, length: 1 });
        at += 1;
      } else {
        walk(child);
      }
    }
  };
  walk(el);
  return out;
}

// What the field shows: its text, and each character's style (from the
// span around it). A block element the browser made counts as a new line.
function read(el: HTMLElement): Model {
  let text = "";
  const styles: (TextStyle | null)[] = [];
  const walk = (parent: Node, style: TextStyle | null) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        text += data;
        for (let i = 0; i < data.length; i++) styles.push(style);
      } else if (child instanceof HTMLBRElement) {
        if (child.hasAttribute("data-wb-end")) continue;
        text += "\n";
        styles.push(style);
      } else if (child instanceof HTMLElement) {
        if ((child.tagName === "DIV" || child.tagName === "P") && text && !text.endsWith("\n")) {
          text += "\n";
          styles.push(null);
        }
        walk(child, child.dataset.s !== undefined ? decodeStyle(child.dataset.s) : style);
      }
    }
  };
  walk(el, null);
  return { text, marks: marksFromStyles(styles) };
}

// A point in the field (node, offset) as a place in its text.
function offsetOf(el: HTMLElement, node: Node, offset: number): number {
  if (!el.contains(node)) return 0;
  const point = document.createRange();
  point.setStart(node, offset);
  let at = 0;
  for (const leaf of leaves(el)) {
    if (leaf.node === node) return leaf.start + offset;
    if (leaf.node instanceof Text) {
      if (point.comparePoint(leaf.node, leaf.length) > 0) break;
    } else {
      const parent = leaf.node.parentNode!;
      const index = [...parent.childNodes].indexOf(leaf.node as ChildNode);
      if (point.comparePoint(parent, index + 1) > 0) break;
    }
    at = leaf.start + leaf.length;
  }
  return at;
}

// A place in the text as a point in the field: the end of the text before
// it (so typing there goes on in its style), except after a line break.
function pointAt(el: HTMLElement, at: number): [Node, number] {
  const all = leaves(el);
  for (const [i, leaf] of all.entries()) {
    if (leaf.node instanceof Text) {
      const end = leaf.start + leaf.length;
      if (at > end) continue;
      const lineEnd = at === end && leaf.node.data.endsWith("\n") && i < all.length - 1;
      if (!lineEnd) return [leaf.node, at - leaf.start];
    } else if (at <= leaf.start) {
      const parent = leaf.node.parentNode!;
      return [parent, [...parent.childNodes].indexOf(leaf.node as ChildNode)];
    }
  }
  const end = el.querySelector("br[data-wb-end]");
  return end ? [el, [...el.childNodes].indexOf(end)] : [el, el.childNodes.length];
}

function selectionIn(el: HTMLElement): { from: number; to: number } | null {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  return { from: offsetOf(el, range.startContainer, range.startOffset), to: offsetOf(el, range.endContainer, range.endOffset) };
}

function select(el: HTMLElement, from: number, to = from) {
  const sel = el.ownerDocument.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(...pointAt(el, from));
  range.setEnd(...pointAt(el, to));
  sel.removeAllRanges();
  sel.addRange(range);
}

const mergePatch = (style: TextStyle, patch: StylePatch | null): TextStyle => {
  if (!patch) return style;
  const out: TextStyle = { ...style };
  for (const [key, value] of Object.entries(patch)) {
    if (value === true || (key === "color" && value)) (out as Record<string, unknown>)[key] = value;
    else delete (out as Record<string, unknown>)[key];
  }
  return out;
};

export function TextEditor({
  className,
  text,
  marks,
  onInput,
  onDone,
  onUndo,
  onStyle,
  placeholder,
  handleRef,
}: {
  className: string;
  text: string;
  marks: TextMark[];
  onInput: (text: string, marks: TextMark[]) => void;
  onDone: () => void;
  // Ctrl/⌘+Z (or Y, or Shift): the board's undo, which then resets the field.
  onUndo: (redo: boolean) => void;
  // The style of the selection, or at the caret (for the bar's buttons).
  onStyle: (style: TextStyle) => void;
  placeholder: string;
  handleRef: RefObject<TextEditorHandle | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const model = useRef<Model>({ text, marks });
  // A style chosen with nothing selected: for what's typed next at `at`.
  const pending = useRef<{ patch: StylePatch; at: number } | null>(null);
  const beforeComposing = useRef<Model | null>(null);
  // Kept current for the listeners added once.
  const props = useRef({ onInput, onUndo, onStyle });
  useLayoutEffect(() => {
    props.current = { onInput, onUndo, onStyle };
  });

  const report = () => {
    const el = ref.current;
    if (!el) return;
    const sel = selectionIn(el);
    if (!sel) return;
    const { text, marks } = model.current;
    const base = styleOf(marks, text.length, sel.from, sel.to);
    props.current.onStyle(pending.current && pending.current.at === sel.from && sel.from === sel.to ? mergePatch(base, pending.current.patch) : base);
  };

  const commit = (next: Model, selection?: { from: number; to: number }) => {
    const el = ref.current!;
    if (next.text.length > MAX_TEXT_LENGTH) {
      next = { text: next.text.slice(0, MAX_TEXT_LENGTH), marks: remapMarks(next.text, next.text.slice(0, MAX_TEXT_LENGTH), next.marks) };
      selection = { from: Math.min(selection?.from ?? MAX_TEXT_LENGTH, MAX_TEXT_LENGTH), to: Math.min(selection?.to ?? MAX_TEXT_LENGTH, MAX_TEXT_LENGTH) };
    }
    model.current = next;
    if (selection) {
      draw(el, next);
      select(el, selection.from, selection.to);
    }
    el.toggleAttribute("data-empty", next.text === "");
    props.current.onInput(next.text, next.marks);
    report();
  };

  // Puts `insert` in place of the selection: its characters take the style
  // before them, or the one chosen for what's typed next.
  const replaceSelection = (insert: string, from: number, to: number) => {
    const { text, marks } = model.current;
    const after = text.slice(0, from) + insert + text.slice(to);
    let nextMarks = remapMarks(text, after, marks);
    if (pending.current && pending.current.at === from) {
      nextMarks = applyStyle(nextMarks, after.length, from, from + insert.length, pending.current.patch);
    }
    pending.current = null;
    commit({ text: after, marks: nextMarks }, { from: from + insert.length, to: from + insert.length });
  };

  const style: TextEditorHandle["style"] = (change) => {
    const el = ref.current;
    if (!el) return;
    const sel = selectionIn(el) ?? { from: model.current.text.length, to: model.current.text.length };
    const { text, marks } = model.current;
    if (sel.from === sel.to) {
      // Nothing selected: for what's typed next.
      const current = mergePatch(styleOf(marks, text.length, sel.from, sel.to), pending.current?.at === sel.from ? pending.current.patch : null);
      const patch: StylePatch = { ...(pending.current?.at === sel.from ? pending.current.patch : {}) };
      if ("flag" in change) patch[change.flag] = !current[change.flag];
      else patch.color = change.color;
      pending.current = { patch, at: sel.from };
      report();
      return;
    }
    const patch: StylePatch =
      "flag" in change ? { [change.flag]: !styleOf(marks, text.length, sel.from, sel.to)[change.flag] } : { color: change.color };
    commit({ text, marks: applyStyle(marks, text.length, sel.from, sel.to, patch) }, sel);
  };

  useImperativeHandle(handleRef, () => ({
    style,
    reset: (text, marks) => {
      const el = ref.current;
      if (!el) return;
      model.current = { text, marks };
      pending.current = null;
      draw(el, model.current);
      select(el, text.length);
      report();
    },
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    draw(el, model.current);
    el.focus({ preventScroll: true });
    select(el, model.current.text.length);
    report();

    const onBeforeInput = (e: InputEvent) => {
      const sel = selectionIn(el);
      if (!sel) return;
      switch (e.inputType) {
        case "insertParagraph":
        case "insertLineBreak": {
          e.preventDefault();
          // In a list, a new line starts the next item (or ends the list on an empty one).
          const { text } = model.current;
          const start = text.lastIndexOf("\n", sel.from - 1) + 1;
          const lineEnd = text.indexOf("\n", sel.from);
          const line = text.slice(start, lineEnd === -1 ? undefined : lineEnd);
          const list = sel.from === sel.to ? enterInList(line) : null;
          if (list && "end" in list) replaceSelection("", start, start + line.length);
          else replaceSelection(`\n${list ? list.continue : ""}`, sel.from, sel.to);
          return;
        }
        case "insertFromPaste":
        case "insertFromPasteAsQuotation":
        case "insertFromDrop":
        case "insertReplacementText": {
          const data = e.dataTransfer?.getData("text/plain") ?? e.data;
          if (data == null) return;
          e.preventDefault();
          if (e.inputType !== "insertFromDrop") replaceSelection(data.replace(/\r\n?/g, "\n"), sel.from, sel.to);
          return;
        }
        case "historyUndo":
        case "historyRedo":
          e.preventDefault();
          props.current.onUndo(e.inputType === "historyRedo");
          return;
        case "formatBold":
        case "formatItalic":
        case "formatUnderline":
        case "formatStrikeThrough":
          e.preventDefault();
          style({ flag: FORMAT_FLAGS[e.inputType] });
          return;
      }
      if (e.inputType.startsWith("format")) e.preventDefault();
    };

    const onAfterInput = (e: Event) => {
      if ((e as InputEvent).isComposing) {
        // Kept as typed for now; styled when the composition ends.
        const next = read(el);
        model.current = next;
        props.current.onInput(next.text, next.marks);
        return;
      }
      const before = model.current;
      const next = read(el);
      const at = pending.current;
      if (at) {
        const changed = changedRange(before.text, next.text);
        if (changed.inserted > 0 && changed.from === at.at) {
          pending.current = null;
          const sel = selectionIn(el);
          commit({ text: next.text, marks: applyStyle(next.marks, next.text.length, changed.from, changed.from + changed.inserted, at.patch) }, sel ?? undefined);
          return;
        }
      }
      // Something the browser drew differently (e.g. it dropped the last span): drawn again.
      const redraw = next.text.length > MAX_TEXT_LENGTH || el.querySelector("div, p, b, i, u, s, strong, em, font") !== null;
      commit(next, redraw ? (selectionIn(el) ?? undefined) : undefined);
    };

    const onCompositionStart = () => {
      beforeComposing.current = model.current;
    };
    const onCompositionEnd = () => {
      const before = beforeComposing.current;
      beforeComposing.current = null;
      const at = pending.current;
      // Read after the browser has put the composed text in.
      queueMicrotask(() => {
        const next = read(el);
        if (at && before) {
          const changed = changedRange(before.text, next.text);
          if (changed.inserted > 0 && changed.from === at.at) {
            pending.current = null;
            const sel = selectionIn(el);
            commit({ text: next.text, marks: applyStyle(next.marks, next.text.length, changed.from, changed.from + changed.inserted, at.patch) }, sel ?? undefined);
            return;
          }
        }
        commit(next);
      });
    };

    const onSelectionChange = () => {
      const sel = selectionIn(el);
      if (!sel) return;
      if (pending.current && (sel.from !== sel.to || sel.from !== pending.current.at)) pending.current = null;
      report();
    };

    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("input", onAfterInput);
    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("input", onAfterInput);
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
    // Once: the field is uncontrolled while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      spellCheck={false}
      data-wb-text-editor
      data-ui="Whiteboard.textInput"
      onBlur={onDone}
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (mod && !e.altKey) {
          const flag: StyleFlag | null =
            key === "b" && !e.shiftKey ? "bold" : key === "i" && !e.shiftKey ? "italic" : key === "u" && !e.shiftKey ? "underline" : key === "s" && e.shiftKey ? "strike" : null;
          if (flag) {
            e.preventDefault();
            style({ flag });
            return;
          }
          if (key === "z" || key === "y") {
            e.preventDefault();
            props.current.onUndo(key === "y" || e.shiftKey);
            return;
          }
        }
        // Back to the board (its keys work again).
        if (e.key === "Escape" || (e.key === "Enter" && mod)) {
          e.preventDefault();
          const board = e.currentTarget.closest<HTMLElement>("[role=application]");
          if (board) board.focus({ preventScroll: true });
          else e.currentTarget.blur();
        }
      }}
    />
  );
}

const FORMAT_FLAGS: Record<string, StyleFlag> = {
  formatBold: "bold",
  formatItalic: "italic",
  formatUnderline: "underline",
  formatStrikeThrough: "strike",
};
