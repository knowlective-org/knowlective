"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { MAX_TITLE_LENGTH } from "@/lib/page-title";
import styles from "./collaborative-editor.module.css";

// A plain textarea bound to a Y.Text: local edits are applied as a minimal
// insert/delete, and remote edits shift the caret instead of resetting it.
export function TitleField({
  ytext,
  readOnly,
  onChange,
  onEnter,
}: {
  ytext: Y.Text;
  readOnly: boolean;
  onChange?: (title: string) => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const t = useTranslations();
  const displayTitle = useDisplayTitle();

  useEffect(() => {
    const sync = (event?: Y.YTextEvent) => {
      const el = ref.current;
      const next = ytext.toString();
      if (!event || event.transaction.local || !el || document.activeElement !== el) {
        setValue(next);
        return;
      }
      // Remote edit while typing: keep the caret next to the same characters.
      const shift = (pos: number) => {
        let index = 0;
        let result = pos;
        for (const op of event.delta) {
          if (op.retain) index += op.retain;
          else if (op.insert) {
            const len = typeof op.insert === "string" ? op.insert.length : 1;
            if (index <= pos) result += len;
            index += len;
          } else if (op.delete && index < pos) {
            result -= Math.min(op.delete, pos - index);
          }
        }
        return result;
      };
      const start = shift(el.selectionStart);
      const end = shift(el.selectionEnd);
      setValue(next);
      requestAnimationFrame(() => el.setSelectionRange(start, end));
    };
    sync();
    ytext.observe(sync);
    return () => ytext.unobserve(sync);
  }, [ytext]);

  useEffect(() => {
    onChange?.(value);
    document.title = `${displayTitle(value)} | KNOWLECTIVE`;
    // Grow with the text instead of scrolling inside the field.
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value, onChange]);

  return (
    <>
    {/* Printed instead of the field, whose height is fitted to the screen's width. */}
    <div className={styles.printTitle} aria-hidden>
      {displayTitle(value)}
    </div>
    <textarea
      ref={ref}
      className={styles.title}
      data-ui="TitleField"
      value={value}
      placeholder={t("common.untitled")}
      readOnly={readOnly}
      rows={1}
      maxLength={MAX_TITLE_LENGTH}
      aria-label={t("editor.titleLabel")}
      spellCheck={false}
      onKeyDown={(e) => {
        // Enter moves to the body, like Notion. Not while an IME is composing.
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      }}
      onChange={(e) => {
        // A title is a single line.
        const next = e.target.value.replace(/[\r\n]+/g, " ");
        const prev = ytext.toString();
        let start = 0;
        while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
        let end = 0;
        while (
          end < prev.length - start &&
          end < next.length - start &&
          prev[prev.length - 1 - end] === next[next.length - 1 - end]
        ) {
          end++;
        }
        ytext.doc!.transact(() => {
          const removed = prev.length - start - end;
          if (removed > 0) ytext.delete(start, removed);
          const inserted = next.slice(start, next.length - end);
          if (inserted) ytext.insert(start, inserted);
        });
        setValue(next);
      }}
    />
    </>
  );
}
