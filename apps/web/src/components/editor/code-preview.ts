// The result of a code block's code, shown below it or in its place (the
// block's `preview` prop, chosen by an editor; code-block.ts):
// - HTML (with its CSS and JavaScript) runs in a sandboxed frame;
// - Markdown is shown formatted, in a sandboxed frame without scripts;
// - Mermaid is drawn as a diagram (as the Mermaid block does);
// - LaTeX is typeset as display math with KaTeX, one formula per paragraph.
//
// The code is written by anyone who can edit the page and shown to everyone
// who can open it (people not logged in too, on a public page), so the frames
// are kept away from the app and the network: `sandbox="allow-scripts"`
// without `allow-same-origin` gives them an origin of their own (no cookies,
// no access to the page around them, no forms, pop-ups or navigating the
// tab), and their CSP allows nothing to be loaded from anywhere (no fetch,
// WebSocket, or images and fonts other than data: and blob: URLs). Should the
// code navigate its frame to another site anyway, the frame is reset.
import type { BlockNoteEditor } from "@blocknote/core";
// Only the styles: KaTeX's fonts are downloaded when a formula uses them.
import "katex/dist/katex.min.css";
import { loadMermaid } from "./mermaid-block";

export const PREVIEW_LANGUAGES = ["html", "markdown", "mermaid", "latex"] as const;
export type PreviewMode = "" | "below" | "only";
export const PREVIEW_MODES: PreviewMode[] = ["", "below", "only"];

export function hasPreview(language: string): boolean {
  return (PREVIEW_LANGUAGES as readonly string[]).includes(language);
}

// The frame's height follows its content, within these bounds.
const MIN_FRAME_HEIGHT = 40;
const MAX_FRAME_HEIGHT = 1200;
const MAX_FORMULAS = 50;

type Katex = (typeof import("katex"))["default"];
let katexLoading: Promise<Katex> | undefined;

// KaTeX is only downloaded once a page shows a formula.
function loadKatex(): Promise<Katex> {
  katexLoading ??= import("katex").then((m) => m.default);
  return katexLoading;
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Tells the page around the frame how tall its content is.
const HEIGHT_SCRIPT = `(() => {
  const post = () => parent.postMessage({ knowlectivePreviewHeight: Math.ceil(document.documentElement.getBoundingClientRect().height) }, "*");
  addEventListener("load", post);
  new ResizeObserver(post).observe(document.documentElement);
})();`;

function frameDocument(body: string, options: { scripts: boolean; style: string }): string {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    options.scripts ? "script-src 'unsafe-inline'" : `script-src 'nonce-${n}'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>${options.style}</style><script nonce="${n}">${HEIGHT_SCRIPT}</script></head>` +
    `<body>${body}</body></html>`
  );
}

// A sandboxed frame showing `html`; returns a function removing its listener.
function showInFrame(
  container: HTMLElement,
  html: string,
  options: { scripts: boolean; style: string; title: string; navigated: () => void },
): () => void {
  const frame = document.createElement("iframe");
  frame.dataset.ui = "CodeBlock.previewFrame";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.title = options.title;
  frame.style.height = `${MIN_FRAME_HEIGHT}px`;
  const source = frameDocument(html, options);
  let loads = 0;
  frame.addEventListener("load", () => {
    loads += 1;
    // The first load is our document; any later one is the code navigating
    // its frame (to another site, or reloading it).
    if (loads > 1) {
      loads = 0;
      frame.srcdoc = source;
      options.navigated();
    }
  });
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const height = Number((event.data as { knowlectivePreviewHeight?: unknown } | null)?.knowlectivePreviewHeight);
    if (Number.isFinite(height)) {
      frame.style.height = `${Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, height))}px`;
    }
  };
  window.addEventListener("message", onMessage);
  frame.srcdoc = source;
  container.replaceChildren(frame);
  return () => window.removeEventListener("message", onMessage);
}

// Formatted text in the page's colors and font.
function documentStyle(container: HTMLElement): string {
  const computed = getComputedStyle(container);
  return `html { color-scheme: light; } body { margin: 0; padding: 4px 2px; font: 15px/1.6 ${computed.fontFamily}; color: ${computed.color}; overflow-wrap: anywhere; }
img { max-width: 100%; } pre { overflow: auto; } table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; }
a { color: inherit; }`;
}

export type PreviewText = { label: string; failed: string; navigated: string };

// Draws the preview of `code` in `container`; the returned function undoes
// what drawing set up (call it before drawing again).
export async function renderPreview(
  container: HTMLElement,
  language: string,
  code: string,
  editor: Pick<BlockNoteEditor, "tryParseMarkdownToBlocks" | "blocksToHTMLLossy">,
  text: PreviewText,
  notify: (message: string) => void,
): Promise<() => void> {
  const error = (message: string) => {
    const p = document.createElement("p");
    p.dataset.ui = "CodeBlock.previewError";
    p.className = "knowlective-code-preview-error";
    p.textContent = message;
    container.replaceChildren(p);
  };
  const navigated = () => notify(text.navigated);
  try {
    switch (language) {
      case "html":
        return showInFrame(container, code, {
          scripts: true,
          style: "body { margin: 8px; }",
          title: text.label,
          navigated,
        });
      case "markdown": {
        const blocks = await editor.tryParseMarkdownToBlocks(code);
        const html = await editor.blocksToHTMLLossy(blocks);
        return showInFrame(container, html, { scripts: false, style: documentStyle(container), title: text.label, navigated });
      }
      case "mermaid": {
        if (!code.trim()) {
          container.replaceChildren();
          break;
        }
        const mermaid = await loadMermaid();
        const id = `code-preview-${nonce()}`;
        try {
          await mermaid.parse(code);
          const { svg } = await mermaid.render(id, code);
          // Drawn with securityLevel "strict" (loadMermaid): no HTML or
          // handlers from the source.
          const figure = document.createElement("div");
          figure.className = "knowlective-code-preview-diagram";
          figure.innerHTML = svg;
          container.replaceChildren(figure);
        } catch (err) {
          document.getElementById(`d${id}`)?.remove();
          error(err instanceof Error ? err.message : String(err));
        }
        break;
      }
      case "latex": {
        const katex = await loadKatex();
        const formulas = code
          .split(/\n\s*\n/)
          .map((f) => f.trim())
          .filter(Boolean)
          .slice(0, MAX_FORMULAS);
        // trust: false keeps \href, \url, \includegraphics and HTML
        // extensions out; KaTeX escapes everything else it outputs.
        const html = formulas
          .map((f) => katex.renderToString(f, { displayMode: true, throwOnError: false, trust: false, strict: "ignore", maxExpand: 1000, maxSize: 50 }))
          .join("");
        const math = document.createElement("div");
        math.className = "knowlective-code-preview-math";
        math.innerHTML = html;
        container.replaceChildren(math);
        break;
      }
      default:
        container.replaceChildren();
    }
  } catch (err) {
    console.warn("[code] preview failed", err);
    error(text.failed);
  }
  return () => {};
}
