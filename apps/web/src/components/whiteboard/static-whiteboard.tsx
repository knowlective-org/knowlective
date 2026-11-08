"use client";

import { useMemo } from "react";
import * as Y from "yjs";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { TITLE_FIELD } from "@/lib/page-title";
import styles from "@/components/collaborative-editor.module.css";
import { WhiteboardCanvas } from "./whiteboard-canvas";

// A whiteboard page's document (`state`: a base64 Yjs update) shown
// read-only from a local Y.Doc that is never connected anywhere: a saved
// version (page history), or a public page seen by someone not logged in.
// The board can still be panned and zoomed.
export function StaticWhiteboard({ state, dataUi }: { state: string; dataUi: string }) {
  const doc = useMemo(() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, Uint8Array.from(atob(state), (c) => c.charCodeAt(0)));
    return d;
  }, [state]);
  const displayTitle = useDisplayTitle();

  return (
    <div data-ui={dataUi}>
      <div className={styles.title}>{displayTitle(doc.getText(TITLE_FIELD).toString())}</div>
      <WhiteboardCanvas doc={doc} readOnly />
    </div>
  );
}
