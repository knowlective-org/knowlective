"use client";

import { useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { showCopyText } from "@/components/dialog";
import { showNotice } from "@/components/notice";
import { findFilePaths } from "@/lib/file-path";

// File paths in the page's text (lib/file-path.ts) are marked, and a click
// on one hands it to `onClick` (which copies it: a browser won't open a
// folder or a local file from a web page).
//
// Marked with the CSS Custom Highlight API (::highlight(knowlective-file-path)
// in globals.css), so the document and the editor's DOM stay as they are.
// Not inside code blocks, where a click is for editing the code.

const HIGHLIGHT = "knowlective-file-path";

function highlight(): Highlight | null {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return null;
  let h = CSS.highlights.get(HIGHLIGHT);
  if (!h) {
    h = new Highlight();
    CSS.highlights.set(HIGHLIGHT, h);
  }
  return h;
}

type PathRange = { range: Range; path: string };

function findRanges(root: HTMLElement): PathRange[] {
  const result: PathRange[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(".bn-inline-content")) {
    if (el.closest('[data-content-type="codeBlock"]')) continue;
    const nodes: { node: Text; start: number }[] = [];
    let text = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, start: text.length });
      text += (n as Text).data;
    }
    for (const m of findFilePaths(text)) {
      const at = (offset: number, end: boolean) => {
        const hit = nodes.findLast((x) => (end ? x.start < offset : x.start <= offset)) ?? nodes[0];
        return { node: hit.node, offset: offset - hit.start };
      };
      const from = at(m.start, false);
      const to = at(m.end, true);
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      result.push({ range, path: m.path });
    }
  }
  return result;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

function attach(root: HTMLElement, onClick: (path: string) => void): () => void {
  let ranges: PathRange[] = [];
  let frame = 0;
  const refresh = () => {
    frame = 0;
    const h = highlight();
    for (const r of ranges) h?.delete(r.range);
    ranges = findRanges(root);
    for (const r of ranges) h?.add(r.range);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  refresh();

  const click = (e: MouseEvent) => {
    if (e.button !== 0 || !window.getSelection()?.isCollapsed) return;
    const caret = caretAt(e.clientX, e.clientY);
    if (!caret) return;
    const hit = ranges.find(
      ({ range }) =>
        range.isPointInRange(caret.node, caret.offset) &&
        // The caret snaps to the nearest text: only a click on the path itself.
        Array.from(range.getClientRects()).some(
          (b) => e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom,
        ),
    );
    if (hit) onClick(hit.path);
  };
  root.addEventListener("click", click);

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    root.removeEventListener("click", click);
    const h = highlight();
    for (const r of ranges) h?.delete(r.range);
  };
}

// For a BlockNote editor (the page's, or a read-only one): a click on a path
// copies it and says so (or, without clipboard access, shows it to copy).
export function useFilePaths(editor: { domElement: HTMLElement | undefined; onMount: (cb: () => void) => () => void }) {
  const t = useTranslations("editor.filePath");
  const onClick = useCallback(
    (path: string) => {
      navigator.clipboard
        .writeText(path)
        .then(() => showNotice(t("copied")))
        .catch(() => showCopyText(t("copyManually"), path, { title: t("copyTitle") }));
    },
    [t],
  );
  useEffect(() => {
    let detach = () => {};
    const start = () => {
      detach();
      detach = editor.domElement ? attach(editor.domElement, onClick) : () => {};
    };
    start();
    const off = editor.onMount(start);
    return () => {
      off();
      detach();
    };
  }, [editor, onClick]);
}
