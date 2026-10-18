"use client";

import { useRef, useState } from "react";
import styles from "./child-blocks.module.css";

// Title shown at the top left of a custom block (child page list / child page table),
// stored in the block's `title` prop. An empty title shows `placeholder` in
// the small label style. Edited locally and saved on blur / Enter, so typing
// doesn't push a document update per keystroke; Esc cancels.
export function BlockTitle({
  value,
  placeholder,
  editable,
  onSave,
  uiName,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  onSave: (title: string) => void;
  // data-ui prefix, e.g. "ChildTableBlock" → ChildTableBlock.titleInput.
  uiName: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  if (!editable) {
    return (
      <span className={value ? styles.blockTitle : styles.blockTitlePlaceholder} data-ui={`${uiName}.title`}>
        {value || placeholder}
      </span>
    );
  }
  return (
    <input
      className={styles.blockTitleInput}
      data-ui={`${uiName}.titleInput`}
      value={draft ?? value}
      placeholder={placeholder}
      maxLength={100}
      aria-label={`${placeholder}のタイトル`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const next = e.target.value.replace(/\s+/g, " ").trim();
        setDraft(null);
        if (!cancelled.current && next !== value) onSave(next);
        cancelled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
