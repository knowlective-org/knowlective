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
  //
  // reload() resolves once data loaded *after* the call has been applied. A
  // request already under way when it's called may have started before the
  // caller's change was saved, so the caller waits for the next one. (Callers
  // that show a change before it's saved drop that overlay when reload()
  // resolves; resolving on the earlier, older answer briefly showed the
  // change undone.)
  const state = useRef({ running: false, again: false, alive: true, waiting: [] as (() => void)[] });
  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const s = state.current;
        s.waiting.push(resolve);
        if (s.running) {
          s.again = true;
          return;
        }
        s.running = true;
        void (async () => {
          try {
            do {
              s.again = false;
              // Answered by this request: whoever was waiting when it started.
              const answered = s.waiting.splice(0);
              const result = await loadRef.current(pageId).catch(() => undefined);
              if (s.alive && result !== undefined) setData(result);
              answered.forEach((done) => done());
            } while (s.again && s.alive);
          } finally {
            s.running = false;
            // Unmounted mid-way: nobody is left to wait for.
            s.waiting.splice(0).forEach((done) => done());
          }
        })();
      }),
    [pageId],
  );

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
