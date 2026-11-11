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
        const scale = Math.min((full ? width - 16 : width) / natural.width, fit / natural.height);
        // Draw at the screen's pixel density, shown at the CSS size.
        const ratio = window.devicePixelRatio || 1;
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
  }, [pdf, page, width, full, full ? height : 0]);

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
      if (e.key === "Escape") setFull(false);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") turn(-1);
      else if (e.key === "ArrowRight" || e.key === "PageDown") turn(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full, pages]);

  return (
    <div className={styles.block} contentEditable={false} data-ui="PdfBlock" data-fullscreen={full || undefined}>
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
            <button
              type="button"
              className={styles.pagerButton}
              onClick={() => setFull(!full)}
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
