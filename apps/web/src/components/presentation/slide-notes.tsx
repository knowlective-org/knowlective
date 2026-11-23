"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { loadSlideNote, saveSlideNote } from "@/app/(app)/pages/[pageId]/presentation-actions";
import { beginSaving } from "@/lib/saving-status";
import styles from "./presentation.module.css";

const SAVE_DELAY_MS = 600;
const MAX_LENGTH = 20_000;

// A slide's speaker notes, for people with edit access. They aren't in the
// slide's document (everyone who can view it receives that): the server hands
// them out only after checking access. Mounted per slide.
export function SlideNotes({ deckId, slideId, canWrite }: { deckId: string; slideId: string; canWrite: boolean }) {
  const t = useTranslations("presentation");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSlideNote(deckId, slideId)
      .then((note) => {
        if (!cancelled) setText(note?.text ?? "");
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, slideId]);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = unsaved.current;
    if (value === null) return;
    unsaved.current = null;
    const finish = beginSaving();
    try {
      const result = await saveSlideNote(deckId, slideId, value);
      setFailed(!!result.error);
    } catch {
      setFailed(true);
    } finally {
      finish();
    }
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  // Leaving the slide doesn't lose what was just typed.
  useEffect(() => () => void flushRef.current(), []);

  if (text === null && !failed) return null;
  return (
    <label className={styles.notes} data-ui="SlideNotes">
      <span>{t("notes")}</span>
      <textarea
        value={text ?? ""}
        readOnly={!canWrite}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder={canWrite ? t("notesPlaceholder") : undefined}
        onChange={(e) => {
          setText(e.target.value);
          unsaved.current = e.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        }}
        onBlur={() => void flush()}
        data-ui="SlideNotes.textInput"
      />
      {failed && (
        <span className={styles.notesError} role="alert" data-ui="SlideNotes.error">
          {t("notesFailed")}
        </span>
      )}
    </label>
  );
}
