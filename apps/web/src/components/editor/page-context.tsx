"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// What custom blocks need from the page they're on. Provided by EditorBody
// (collaborative-editor.tsx) around BlockNoteView; BlockNote renders blocks
// through portals, so context reaches them.
export type PageEditorContextValue = {
  pageId: string;
  // Subscribes to "this page's children changed" (lib/collab-events.ts).
  onChildrenChanged(listener: () => void): () => void;
};

export const PageEditorContext = createContext<PageEditorContextValue | null>(null);

export function usePageEditor(): PageEditorContextValue {
  const ctx = useContext(PageEditorContext);
  if (!ctx) throw new Error("usePageEditor must be used inside PageEditorContext");
  return ctx;
}

// Loads data about the current page's children and reloads it whenever the
// collab server says they changed, or the tab regains focus (a notification
// may have been missed while the connection was down).
// data: undefined while loading, null when not allowed.
export function useChildrenData<T>(load: (pageId: string) => Promise<T | null>) {
  const { pageId, onChildrenChanged } = usePageEditor();
  const [data, setData] = useState<T | null | undefined>(undefined);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  // One request at a time; a change arriving mid-request triggers exactly
  // one more, so bursts of notifications don't pile up requests.
  const state = useRef({ running: false, again: false, alive: true });
  const reload = useCallback(async () => {
    const s = state.current;
    if (s.running) {
      s.again = true;
      return;
    }
    s.running = true;
    try {
      do {
        s.again = false;
        const result = await loadRef.current(pageId).catch(() => undefined);
        if (s.alive && result !== undefined) setData(result);
      } while (s.again && s.alive);
    } finally {
      s.running = false;
    }
  }, [pageId]);

  useEffect(() => {
    const s = state.current;
    s.alive = true;
    void reload();
    const off = onChildrenChanged(() => void reload());
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      s.alive = false;
      off();
      window.removeEventListener("focus", onFocus);
    };
  }, [reload, onChildrenChanged]);

  return { data, reload };
}
