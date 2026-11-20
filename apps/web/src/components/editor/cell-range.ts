"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Selecting cells of a table like a spreadsheet (the child page table):
// dragging from one cell to another, or Shift+clicking a cell, selects the
// rectangle between them; Ctrl/⌘+C copies it, Esc or a press outside lets it
// go. A plain click still goes to what's in the cell (an input, a menu), and
// becomes the start of the next Shift+click. Ctrl/⌘+C in a cell with nothing
// selected copies that cell (its text, unless some of it is selected).
//
// Cells are the elements with data-r / data-c (row and column indices) in
// the container. Native listeners on it: inside the editor, ProseMirror gets
// React's events too late (it has its own on the editor's element).

export type CellPos = { r: number; c: number };
export type CellRange = { anchor: CellPos; focus: CellPos };

export function rangeBounds(range: CellRange) {
  return {
    top: Math.min(range.anchor.r, range.focus.r),
    bottom: Math.max(range.anchor.r, range.focus.r),
    left: Math.min(range.anchor.c, range.focus.c),
    right: Math.max(range.anchor.c, range.focus.c),
  };
}

export function inRange(range: CellRange | null, r: number, c: number): boolean {
  if (!range) return false;
  const b = rangeBounds(range);
  return r >= b.top && r <= b.bottom && c >= b.left && c <= b.right;
}

const same = (a: CellPos, b: CellPos) => a.r === b.r && a.c === b.c;

// `root`: the table (from a callback ref: it comes and goes with the data).
export function useCellRange(
  root: HTMLElement | null,
  copy: (range: CellRange) => void,
): { range: CellRange | null; clear: () => void } {
  const [range, setRange] = useState<CellRange | null>(null);
  // What the listeners read: the range as last set, the latest copy function.
  const rangeRef = useRef<CellRange | null>(null);
  const copyRef = useRef(copy);
  useLayoutEffect(() => {
    copyRef.current = copy;
  });
  const set = (next: CellRange | null) => {
    rangeRef.current = next;
    setRange(next);
  };

  useEffect(() => {
    if (!root) return;
    // The cell last pressed in (the start of a Shift+click or a drag).
    let anchor: CellPos | null = null;
    let dragging = false;

    const cellAt = (el: Element | null): CellPos | null => {
      const cell = el?.closest<HTMLElement>("[data-r][data-c]");
      if (!cell || !root.contains(cell)) return null;
      return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
    };
    // Into range mode: what had the focus (an input) lets it go, the text
    // selection too, and the container takes the keys.
    const select = (next: CellRange) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && root.contains(active) && active !== root) active.blur();
      window.getSelection()?.removeAllRanges();
      root.focus({ preventScroll: true });
      set(next);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const pos = cellAt(e.target as Element);
      if (!pos) return;
      if (e.shiftKey && anchor) {
        e.preventDefault();
        e.stopPropagation();
        select({ anchor, focus: pos });
        return;
      }
      anchor = pos;
      dragging = true;
      if (rangeRef.current) set(null);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || !anchor || (e.buttons & 1) === 0) return;
      const pos = cellAt(document.elementFromPoint(e.clientX, e.clientY));
      if (!pos) return;
      const current = rangeRef.current;
      if (current ? same(current.focus, pos) : same(anchor, pos)) return;
      e.preventDefault();
      select({ anchor, focus: pos });
    };
    const onMouseUp = () => {
      dragging = false;
    };
    // A press anywhere else lets the range go.
    const onDocumentDown = (e: MouseEvent) => {
      if (rangeRef.current && !root.contains(e.target as Node)) set(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const current = rangeRef.current;
      const copyKey = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c";
      if (current) {
        if (copyKey) {
          e.preventDefault();
          e.stopPropagation();
          copyRef.current(current);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          set(null);
        }
        return;
      }
      if (!copyKey) return;
      const pos = cellAt(e.target as Element);
      if (!pos) return;
      // Text selected in a field: copied as usual.
      const field = e.target as HTMLInputElement | HTMLTextAreaElement;
      const textField = field.tagName === "TEXTAREA" || (field.tagName === "INPUT" && ["text", "search", ""].includes(field.type));
      if (textField && field.selectionStart !== field.selectionEnd) return;
      if (!textField && !window.getSelection()?.isCollapsed) return;
      e.preventDefault();
      e.stopPropagation();
      copyRef.current({ anchor: pos, focus: pos });
    };

    root.addEventListener("mousedown", onMouseDown);
    root.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onDocumentDown);
    return () => {
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onDocumentDown);
    };
  }, [root]);

  return { range, clear: () => set(null) };
}
