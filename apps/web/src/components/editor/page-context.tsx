"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// What custom blocks need from the page they're on. Provided by EditorBody
// (collaborative-editor.tsx) around BlockNoteView; BlockNote renders blocks
// through portals, so context reaches them.
export type PageEditorContextValue = {
  pageId: string;
  // The viewer; null for someone not logged in.
  userId: string | null;
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
// `sourceId`: another page's children (a linked view, lib/linked-views.ts;
// the collab server sends their changes here too); "" loads nothing (a
// linked view whose page isn't chosen yet).
export function useChildrenData<T>(load: (pageId: string) => Promise<T | null>, sourceId?: string) {
  const { pageId: ownId, onChildrenChanged } = usePageEditor();
  const pageId = sourceId ?? ownId;
  // What was loaded, and for which page (another one chosen: loading again).
  const [loaded, setLoaded] = useState<{ pageId: string; value: T | null } | null>(null);
  const data = loaded?.pageId === pageId ? loaded.value : undefined;
  const loadRef = useRef(load);
  // The page to load now: a request already under way when another page is
  // chosen is followed by one for the new page.
  const idRef = useRef(pageId);
  useEffect(() => {
    loadRef.current = load;
    idRef.current = pageId;
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
              const id = idRef.current;
              const result = await loadRef.current(id).catch(() => undefined);
              if (s.alive && result !== undefined) setLoaded({ pageId: id, value: result });
              answered.forEach((done) => done());
            } while (s.again && s.alive);
          } finally {
            s.running = false;
            // Unmounted mid-way: nobody is left to wait for.
            s.waiting.splice(0).forEach((done) => done());
          }
        })();
      }),
    [],
  );

  useEffect(() => {
    const s = state.current;
    s.alive = true;
    if (!pageId) return;
    void reload();
    const off = onChildrenChanged(() => void reload());
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      s.alive = false;
      off();
      window.removeEventListener("focus", onFocus);
    };
    // Another page chosen: loaded again (reload() reads it from idRef).
  }, [reload, onChildrenChanged, pageId]);

  return { data, reload };
}
