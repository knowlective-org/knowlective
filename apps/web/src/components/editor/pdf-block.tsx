"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { createReactBlockSpec } from "@blocknote/react";
import { resolveAppUrl } from "@/lib/base-path";
import { type PdfDocument, type PdfJs, loadPdfJs, pdfOptions } from "./pdf-loader";
import styles from "./pdf-block.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

// The tallest a page is drawn, so a portrait page doesn't fill the screen.
const MAX_PAGE_HEIGHT = 480;

// Full screen zoom, relative to the page fitted to the window.
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
// Browsers refuse (or draw blank) canvases much larger than this many pixels
// (Safari's limit), so a zoomed page is drawn at a lower density instead.
const MAX_CANVAS_PIXELS = 16_000_000;

function nextZoom(zoom: number, by: 1 | -1): number {
  if (by > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? zoom;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? zoom;
}

// PDF: an attached PDF shown one page at a time. The document holds only the
// file's URL (/api/files/<id>, which checks the viewer's access) and name;
// the page being looked at is each viewer's own.
export const pdfBlock = createReactBlockSpec(
  BLOCK_CONFIGS.pdf,
  {
    // The file is stored as "/api/files/<id>", without the base path. Only
    // that is loaded: the URL comes from the shared document, and anything
    // else would make every viewer's browser fetch an address of the
    // editor's choosing.
    render: ({ block }) => (
      <PdfViewer url={ATTACHMENT_URL.test(block.props.url) ? resolveAppUrl(block.props.url) : ""} name={block.props.name} />
    ),
  },
);

const ATTACHMENT_URL = /^\/api\/files\/[A-Za-z0-9_-]+$/;

function PdfViewer({ url, name }: { url: string; name: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<"passwordProtected" | "failed" | "pageFailed" | null>(null);
  const [page, setPage] = useState(1);
  const t = useTranslations("editor.pdf");
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  // Full screen: the block fills the window (over the page), on the same
  // page of the PDF; Esc or the button leaves, ← → turn pages.
  const [full, setFull] = useState(false);
  // Zoom while full screen (1 = the page fits the window). Leaving full
  // screen goes back to fitting.
  const [zoom, setZoom] = useState(1);
  const zoomBy = (by: 1 | -1) => setZoom((z) => nextZoom(z, by));
  const toggleFull = () => {
    setFull(!full);
    setZoom(1);
  };

  useEffect(() => {
    if (!url) return;
    let stale = false;
    let task: ReturnType<PdfJs["getDocument"]> | undefined;
    void loadPdfJs()
      .then((pdfjs) => {
        if (stale) return;
        // Forms are drawn as they look; nothing in the PDF is run.
        task = pdfjs.getDocument({ url, ...pdfOptions(pdfjs) });
        return task.promise;
      })
      .then((loaded) => {
        if (loaded && !stale) setPdf(loaded);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError(
          (err as { name?: string })?.name === "PasswordException"
            ? "passwordProtected"
            : "failed",
        );
      });
    return () => {
      stale = true;
      void task?.destroy();
    };
  }, [url]);

  // Redraw to fit when the editor's width changes.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
      setHeight(Math.floor(entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!pdf || !el || width === 0) return;
    let stale = false;
    let rendering: { cancel: () => void; promise: Promise<void> } | undefined;
    void pdf
      .getPage(page)
      .then((pdfPage) => {
        if (stale) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const fit = full ? Math.max(100, height - 16) : MAX_PAGE_HEIGHT;
        const scale =
          Math.min((full ? width - 16 : width) / natural.width, fit / natural.height) * (full ? zoom : 1);
        // Draw at the screen's pixel density, shown at the CSS size (lower
        // when that would be too large a canvas).
        const area = natural.width * scale * natural.height * scale;
        const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / area));
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        el.width = Math.floor(viewport.width);
        el.height = Math.floor(viewport.height);
        el.style.width = `${Math.floor(natural.width * scale)}px`;
        el.style.height = `${Math.floor(natural.height * scale)}px`;
        rendering = pdfPage.render({ canvas: el, viewport });
        return rendering.promise;
      })
      .catch((err: unknown) => {
        // Cancelled because the page or the width changed again.
        if (stale || (err as { name?: string })?.name === "RenderingCancelledException") return;
        setError("pageFailed");
      });
    return () => {
      stale = true;
      rendering?.cancel();
    };
    // (The height only matters full screen; it follows the drawn page otherwise.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, page, width, full, full ? height : 0, full ? zoom : 1]);

  // A new page (or zoom) starts at its top left.
  useEffect(() => {
    frame.current?.scrollTo({ top: 0, left: 0 });
  }, [page, zoom]);

  const pages = pdf?.numPages ?? 0;
  const go = (next: number) => {
    setError(null);
    setPage(Math.min(Math.max(next, 1), pages));
  };

  // Full screen: Esc leaves; ← → (and PageUp / PageDown) turn pages.
  useEffect(() => {
    if (!full) return;
    const turn = (by: number) => {
      setError(null);
      setPage((p) => Math.min(Math.max(p + by, 1), Math.max(pages, 1)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFull(false);
        setZoom(1);
      } else if (e.key === "+" || e.key === "=") setZoom((z) => nextZoom(z, 1));
      else if (e.key === "-") setZoom((z) => nextZoom(z, -1));
      else if (e.key === "0") setZoom(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") turn(-1);
      else if (e.key === "ArrowRight" || e.key === "PageDown") turn(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full, pages]);

  // Full screen: Ctrl/⌘ + wheel (and a trackpad's pinch, which browsers send
  // as one) zooms; dragging a zoomed page moves it. Listened to on the frame
  // itself, so the editor doesn't take the drag as a selection.
  useEffect(() => {
    const el = frame.current;
    if (!full || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY !== 0) setZoom((z) => nextZoom(z, e.deltaY < 0 ? 1 : -1));
    };
    let drag: { x: number; y: number; left: number; top: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      el.scrollLeft = drag.left - (e.clientX - drag.x);
      el.scrollTop = drag.top - (e.clientY - drag.y);
    };
    const onUp = () => {
      drag = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [full]);

  return (
    <div
      className={styles.block}
      contentEditable={false}
      data-ui="PdfBlock"
      data-fullscreen={full || undefined}
      data-zoomed={(full && zoom > 1) || undefined}
    >
      <div className={styles.frame} ref={frame}>
        {!url ? (
          <p className={styles.muted}>{t("none")}</p>
        ) : error ? (
          <p className={styles.error} data-ui="PdfBlock.error">
            {t(error)}
          </p>
        ) : (
          !pdf && <p className={styles.muted}>{t("loading")}</p>
        )}
        <canvas
          ref={canvas}
          className={styles.page}
          hidden={!pdf || error !== null}
          role="img"
          aria-label={t("pageLabel", { name: name || "PDF", page })}
          data-ui="PdfBlock.page"
        />
      </div>
      <div className={styles.bar}>
        {url && (
          <a className={styles.name} href={url} download={name || true} title={t("download")} data-ui="PdfBlock.downloadLink">
            {name || "PDF"}
          </a>
        )}
        {pages > 0 && (
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.pagerButton}
              disabled={page <= 1}
              onClick={() => go(page - 1)}
              aria-label={t("previous")}
              data-ui="PdfBlock.previousButton"
            >
              ‹
            </button>
            <span className={styles.count} aria-live="polite" data-ui="PdfBlock.status">
              {page} / {pages}
            </span>
            <button
              type="button"
              className={styles.pagerButton}
              disabled={page >= pages}
              onClick={() => go(page + 1)}
              aria-label={t("next")}
              data-ui="PdfBlock.nextButton"
            >
              ›
            </button>
            {full && (
              <>
                <button
                  type="button"
                  className={styles.pagerButton}
                  disabled={zoom <= ZOOM_STEPS[0]}
                  onClick={() => zoomBy(-1)}
                  aria-label={t("zoomOut")}
                  title={t("zoomOut")}
                  data-ui="PdfBlock.zoomOutButton"
                >
                  <Icon name="zoomOut" size={18} />
                </button>
                <button
                  type="button"
                  className={styles.zoomButton}
                  onClick={() => setZoom(1)}
                  aria-label={t("zoomReset")}
                  title={t("zoomReset")}
                  data-ui="PdfBlock.zoomStatus"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className={styles.pagerButton}
                  disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                  onClick={() => zoomBy(1)}
                  aria-label={t("zoomIn")}
                  title={t("zoomIn")}
                  data-ui="PdfBlock.zoomInButton"
                >
                  <Icon name="zoomIn" size={18} />
                </button>
              </>
            )}
            <button
              type="button"
              className={styles.pagerButton}
              onClick={toggleFull}
              aria-label={full ? t("exitFullscreen") : t("fullscreen")}
              title={full ? t("exitFullscreen") : t("fullscreen")}
              aria-pressed={full}
              data-ui="PdfBlock.fullscreenButton"
            >
              <Icon name={full ? "exitFullscreen" : "fullscreen"} size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
