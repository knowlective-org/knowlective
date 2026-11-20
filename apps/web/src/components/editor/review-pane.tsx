"use client";

import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { loadReviewThreads, setReviewResolved } from "@/app/(app)/pages/[pageId]/review-actions";
import { reviewChatKey, type ReviewThreads } from "@/lib/review-threads";
import { showAlert } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { ChatThread } from "./chat-block";
import { useChildrenData, usePageEditor } from "./page-context";
import type { KnowlectiveEditor } from "./schema";
import styles from "./review-pane.module.css";

// Review threads (lib/review-threads.ts): a chat about one of the page's
// top-level blocks, started from its ⋮⋮ menu ("Start a chat"), shown in a
// pane beside the page (the page is split in two; the pane stays in view as
// the page scrolls). Like comments: not part of the document, so never
// printed or exported. A block with an open thread has a mark on its right
// with the number of messages; a resolved thread's mark goes away until a new
// message opens it again.

type ReviewApi = {
  threads: ReviewThreads | null | undefined;
  // The block whose thread is shown, null: the pane is closed.
  activeId: string | null;
  open: (blockId: string) => void;
  close: () => void;
  reload: () => Promise<void>;
};

const ReviewContext = createContext<ReviewApi | null>(null);

export function useReview(): ReviewApi | null {
  return useContext(ReviewContext);
}

export function ReviewProvider({ children }: { children: ReactNode }) {
  const { data: threads, reload } = useChildrenData(loadReviewThreads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const open = useCallback((blockId: string) => setActiveId(blockId), []);
  const close = useCallback(() => setActiveId(null), []);
  return <ReviewContext.Provider value={{ threads, activeId, open, close, reload }}>{children}</ReviewContext.Provider>;
}

// A block's text, for the top of the pane (what the thread is about).
type InlineLike = { type?: string; text?: string; content?: unknown };
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c: InlineLike) => (typeof c?.text === "string" ? c.text : textOf(c?.content))).join("");
}

// The page split in two while a thread is open: the document (with the marks
// beside its blocks) and the pane.
export function ReviewLayout({ editor, children }: { editor: KnowlectiveEditor; children: ReactNode }) {
  const review = useReview();
  const active = review?.activeId ?? null;
  return (
    <div className={active ? styles.split : undefined} data-ui="ReviewLayout">
      <div className={styles.main}>
        {children}
        {review && <ReviewMarkers editor={editor} review={review} />}
      </div>
      {review && active && <ReviewPane key={active} editor={editor} review={review} blockId={active} />}
    </div>
  );
}

type Place = { id: string; top: number; height: number };

// The marks beside the blocks with an open thread (and the frame around the
// block whose thread is shown), placed from the blocks on screen: measured
// again when the document, the size or the threads change.
function ReviewMarkers({ editor, review }: { editor: KnowlectiveEditor; review: ReviewApi }) {
  const t = useTranslations("editor.review");
  const ref = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const shown = (review.threads?.threads ?? []).filter((th) => th.count > 0 && (!th.resolved || th.blockId === review.activeId));
  const ids = [...new Set([...shown.map((th) => th.blockId), ...(review.activeId ? [review.activeId] : [])])];
  const key = ids.join(" ");

  useLayoutEffect(() => {
    const layer = ref.current;
    const main = layer?.parentElement;
    if (!layer || !main) return;
    // Nothing to mark: no listening to every change of the document.
    if (!key) {
      setPlaces((prev) => (prev.length ? [] : prev));
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const base = main.getBoundingClientRect();
        const next: Place[] = [];
        for (const id of key.split(" ")) {
          const el = main.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
          if (!el) continue;
          const box = el.getBoundingClientRect();
          next.push({ id, top: box.top - base.top, height: box.height });
        }
        // Unchanged (most edits): no render.
        setPlaces((prev) =>
          prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.top === next[i].top && p.height === next[i].height) ? prev : next,
        );
      });
    };
    measure();
    const unsubscribe = editor.onChange(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe?.();
      observer.disconnect();
    };
  }, [editor, key]);

  return (
    <div ref={ref} className={styles.layer} aria-hidden={places.length === 0 || undefined}>
      {places.map((p) => {
        const thread = shown.find((th) => th.blockId === p.id);
        const isActive = p.id === review.activeId;
        return (
          <div key={p.id}>
            {isActive && <div className={styles.highlight} style={{ top: p.top, height: p.height }} data-ui="ReviewMarkers.highlight" />}
            {thread && (
              <button
                type="button"
                className={isActive ? styles.markerActive : styles.marker}
                style={{ top: p.top }}
                onClick={() => (isActive ? review.close() : review.open(p.id))}
                aria-label={t("marker", { count: thread.count })}
                title={t("marker", { count: thread.count })}
                data-ui="ReviewMarkers.button"
                data-id={p.id}
              >
                <Icon name="chat" size={14} />
                <span>{thread.count}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewPane({ editor, review, blockId }: { editor: KnowlectiveEditor; review: ReviewApi; blockId: string }) {
  const t = useTranslations("editor.review");
  const failed = useTranslations("editor.save")("failed");
  const { pageId } = usePageEditor();
  const [busy, setBusy] = useState(false);
  const thread = review.threads?.threads.find((th) => th.blockId === blockId);
  const block = editor.getBlock(blockId);
  const excerpt = block ? textOf(block.content).trim() : null;
  const ref = useRef<HTMLElement>(null);

  // Opened: the pane comes into view (on a narrow screen it's over the page).
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const resolve = async (resolved: boolean) => {
    setBusy(true);
    try {
      const result = await setReviewResolved(pageId, blockId, resolved).catch(() => ({ error: failed }));
      if (result.error) await showAlert(result.error);
      await review.reload();
      if (resolved && !result.error) review.close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className={styles.pane}
      aria-label={t("title")}
      data-ui="ReviewPane"
      data-id={blockId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) review.close();
      }}
    >
      <div className={styles.header}>
        <Icon name="chat" size={18} />
        <span className={styles.title}>{t("title")}</span>
        {review.threads?.canPost && thread && thread.count > 0 && (
          <button
            type="button"
            className={styles.resolveButton}
            disabled={busy}
            onClick={() => void resolve(!thread.resolved)}
            data-ui={thread.resolved ? "ReviewPane.reopenButton" : "ReviewPane.resolveButton"}
          >
            {thread.resolved ? t("reopen") : t("resolve")}
          </button>
        )}
        <button type="button" className={styles.closeButton} onClick={review.close} aria-label={t("close")} title={t("close")} data-ui="ReviewPane.closeButton">
          ×
        </button>
      </div>
      <blockquote className={styles.quote} data-ui="ReviewPane.blockText">
        {excerpt === null ? t("blockGone") : excerpt || t("noText")}
      </blockquote>
      {thread?.resolved && (
        <p className={styles.resolved} role="status" data-ui="ReviewPane.resolvedStatus">
          {t("resolved")}
        </p>
      )}
      <ChatThread chatKey={reviewChatKey(blockId)} />
    </aside>
  );
}
