"use client";

import { useEffect, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import styles from "./pdf-block.module.css";

// The tallest a page is drawn, so a portrait page doesn't fill the screen.
const MAX_PAGE_HEIGHT = 480;

type PdfJs = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
let pdfjsLoading: Promise<PdfJs> | undefined;

// The worker and the data pdf.js fetches on demand come from /api/pdfjs.
const assetUrl = (pdfjs: PdfJs, dir: string) => `/api/pdfjs/${pdfjs.version}/${dir}`;

// pdf.js is large, so it's only downloaded once a page shows a PDF.
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoading ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = assetUrl(pdfjs, "build/pdf.worker.min.mjs");
    return pdfjs;
  });
  return pdfjsLoading;
}

// PDF: an attached PDF shown one page at a time. The document holds only the
// file's URL (/api/files/<id>, which checks the viewer's access) and name;
// the page being looked at is each viewer's own.
export const pdfBlock = createReactBlockSpec(
  {
    type: "pdf",
    propSchema: {
      url: { default: "" },
      name: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => <PdfViewer url={block.props.url} name={block.props.name} />,
  },
);

function PdfViewer({ url, name }: { url: string; name: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!url) return;
    let stale = false;
    let task: ReturnType<PdfJs["getDocument"]> | undefined;
    void loadPdfJs()
      .then((pdfjs) => {
        if (stale) return;
        task = pdfjs.getDocument({
          url,
          cMapUrl: assetUrl(pdfjs, "cmaps/"),
          cMapPacked: true,
          standardFontDataUrl: assetUrl(pdfjs, "standard_fonts/"),
          wasmUrl: assetUrl(pdfjs, "wasm/"),
          iccUrl: assetUrl(pdfjs, "iccs/"),
          // Forms are drawn as they look; nothing in the PDF is run.
          enableXfa: false,
        });
        return task.promise;
      })
      .then((loaded) => {
        if (loaded && !stale) setPdf(loaded);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError(
          (err as { name?: string })?.name === "PasswordException"
            ? "パスワードで保護された PDF は表示できません。"
            : "PDF を表示できませんでした。",
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
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
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
        const scale = Math.min(width / natural.width, MAX_PAGE_HEIGHT / natural.height);
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
        setError("このページを表示できませんでした。");
      });
    return () => {
      stale = true;
      rendering?.cancel();
    };
  }, [pdf, page, width]);

  const pages = pdf?.numPages ?? 0;
  const go = (next: number) => {
    setError(null);
    setPage(Math.min(Math.max(next, 1), pages));
  };

  return (
    <div className={styles.block} contentEditable={false} data-ui="PdfBlock">
      <div className={styles.frame} ref={frame}>
        {!url ? (
          <p className={styles.muted}>PDF がありません。</p>
        ) : error ? (
          <p className={styles.error} data-ui="PdfBlock.error">
            {error}
          </p>
        ) : (
          !pdf && <p className={styles.muted}>PDF を読み込んでいます…</p>
        )}
        <canvas
          ref={canvas}
          className={styles.page}
          hidden={!pdf || error !== null}
          role="img"
          aria-label={`${name || "PDF"} の ${page} ページ`}
          data-ui="PdfBlock.page"
        />
      </div>
      <div className={styles.bar}>
        {url && (
          <a className={styles.name} href={url} download={name || true} title="ダウンロード" data-ui="PdfBlock.downloadLink">
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
              aria-label="前のページ"
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
              aria-label="次のページ"
              data-ui="PdfBlock.nextButton"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
