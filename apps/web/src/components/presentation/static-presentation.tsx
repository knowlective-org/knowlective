"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { loadPresentation, loadSlideStates } from "@/app/(app)/pages/[pageId]/presentation-actions";
import { EditorPlaceholder } from "@/components/editor-placeholder";
import { WhiteboardCanvas } from "@/components/whiteboard/whiteboard-canvas";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { TITLE_FIELD } from "@/lib/page-title";
import type { DeckView } from "@/lib/presentation-data";
import editorStyles from "@/components/collaborative-editor.module.css";
import styles from "./presentation.module.css";

// A public presentation for someone not logged in: its shown slides one at a
// time, read-only and not connected to collaborative editing.
export function StaticPresentation({ pageId, state, dataUi }: { pageId: string; state: string; dataUi: string }) {
  const t = useTranslations("presentation");
  const displayTitle = useDisplayTitle();
  const title = useMemo(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(atob(state), (c) => c.charCodeAt(0)));
    const text = doc.getText(TITLE_FIELD).toString();
    doc.destroy();
    return text;
  }, [state]);
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [index, setIndex] = useState(0);
  const [slide, setSlide] = useState<{ id: string; doc: Y.Doc } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPresentation(pageId).then((d) => {
      if (!cancelled) setDeck(d);
    });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const current = deck?.slides[index] ?? null;
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    void loadSlideStates(pageId, [currentId]).then(([loaded]) => {
      if (cancelled || !loaded) return;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Uint8Array.from(atob(loaded.state), (c) => c.charCodeAt(0)));
      setSlide({ id: loaded.id, doc });
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, currentId]);

  if (!deck) return <EditorPlaceholder />;
  const count = deck.slides.length;
  return (
    <div data-ui={dataUi}>
      <div className={editorStyles.title}>{displayTitle(title)}</div>
      {current && slide?.id === current.id ? (
        <WhiteboardCanvas key={slide.id} doc={slide.doc} readOnly slide={{ number: current.number, position: deck.settings.numberPosition }} />
      ) : (
        <p className={styles.empty}>{count === 0 ? t("noSlides") : t("loading")}</p>
      )}
      {count > 0 && (
        <div className={styles.pager} data-ui="StaticPresentation.pager">
          <button type="button" disabled={index === 0} onClick={() => setIndex((i) => i - 1)} data-ui="StaticPresentation.previousButton">
            {t("previous")}
          </button>
          <span role="status" data-ui="StaticPresentation.status">
            {index + 1} / {count}
          </span>
          <button type="button" disabled={index >= count - 1} onClick={() => setIndex((i) => i + 1)} data-ui="StaticPresentation.nextButton">
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}
