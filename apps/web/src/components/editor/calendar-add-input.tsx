"use client";

import { useState } from "react";
import styles from "./child-calendar-block.module.css";

// A new page's title, typed in the calendar: Enter adds (empty is an untitled
// page), Esc cancels, leaving it empty cancels.
export function CalendarAddInput({ placeholder, onDone }: { placeholder: string; onDone: (title: string | null) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const submit = async (value: string | null) => {
    if (busy) return;
    setBusy(true);
    await onDone(value === null ? null : value.replace(/\s+/g, " ").trim());
  };
  return (
    <input
      className={styles.addInput}
      data-ui="ChildCalendarBlock.addInput"
      placeholder={placeholder}
      maxLength={200}
      autoFocus
      disabled={busy}
      aria-label={placeholder}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") void submit(e.currentTarget.value);
        if (e.key === "Escape") void submit(null);
      }}
      onBlur={(e) => void submit(e.currentTarget.value.trim() ? e.currentTarget.value : null)}
    />
  );
}
