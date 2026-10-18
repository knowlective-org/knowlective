import type { ChildPageItem } from "@/lib/page-property-types";
import { displayTitle } from "@/lib/page-title";

// Getting a page's blocks ready for BlockNote's exporters (Markdown, PDF).

export type ExportBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: ExportBlock[];
};

// Blocks made here are complete (props, content as an array, children): the
// PDF exporter, unlike the Markdown one, doesn't fill in what's missing.
const text = (value: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: value, styles });
const link = (href: string, label: string) => ({ type: "link", href, content: [text(label)] });
const block = (type: string, content: unknown[], extra: Partial<ExportBlock> = {}): ExportBlock => ({
  type,
  props: {},
  content,
  children: [],
  ...extra,
});

export function hasChildPageBlocks(blocks: ExportBlock[]): boolean {
  return blocks.some(
    (b) =>
      b.type === "childPages" ||
      b.type === "childTable" ||
      b.type === "childBoard" ||
      hasChildPageBlocks(b.children ?? []),
  );
}

function childPageList(pages: ChildPageItem[], parentId: string, levels: number, origin: string): ExportBlock[] {
  return pages
    .filter((page) => page.parentId === parentId)
    .map((page) =>
      block("bulletListItem", [link(`${origin}/pages/${page.id}`, displayTitle(page.title))], {
        children: levels > 1 ? childPageList(pages, page.id, levels - 1, origin) : [],
      }),
    );
}

// The page's blocks with KNOWLECTIVE's own block types replaced by standard ones
// (the exporters have no equivalent, and BlockNote's Markdown export would
// otherwise write out their on-screen controls):
// - Mermaid diagram → a ```mermaid code block; with `mermaid: "keep"` it's left
//   for the exporter to draw (PDF)
// - PDF → a link to the file
// - Link preview → a link with the page's title
// - Video embed → a link to the video
// - Child page list / table / board → a list of links to the child pages the
//   exporting user can see (the table's columns and the board's lanes are left out)
// and with links to attachments made absolute, so they work outside the site.
export function prepareBlocksForExport(
  blocks: ExportBlock[],
  options: { origin: string; pageId: string; childPages: ChildPageItem[] | null; mermaid?: "code" | "keep" },
): ExportBlock[] {
  const { origin, pageId, childPages } = options;
  const absolute = (url: unknown) => (typeof url === "string" && url.startsWith("/") ? origin + url : url);

  return blocks.flatMap((b): ExportBlock[] => {
    const children = prepareBlocksForExport(b.children ?? [], options);
    switch (b.type) {
      case "mermaid":
        if (options.mermaid === "keep") return [{ ...b, children: [] }, ...children];
        return [
          block("codeBlock", [text(String(b.props?.code ?? ""))], { props: { language: "mermaid" } }),
          ...children,
        ];
      case "pdf": {
        const url = absolute(b.props?.url);
        if (typeof url !== "string" || !url) return children;
        return [block("paragraph", [link(url, String(b.props?.name || "PDF"))]), ...children];
      }
      case "linkPreview": {
        const url = String(b.props?.url ?? "");
        if (!/^https?:\/\//i.test(url)) return children;
        return [block("paragraph", [link(url, String(b.props?.title || url))]), ...children];
      }
      case "videoEmbed": {
        const url = String(b.props?.url ?? "");
        if (!/^https?:\/\//i.test(url)) return children;
        return [block("paragraph", [link(url, url)]), ...children];
      }
      case "childPages":
      case "childTable":
      case "childBoard": {
        const levels = b.type === "childPages" ? Number(b.props?.depth ?? 1) : 1;
        const title = String(b.props?.title ?? "");
        return [
          ...(title ? [block("paragraph", [text(title, { bold: true })])] : []),
          ...childPageList(childPages ?? [], pageId, levels, origin),
          ...children,
        ];
      }
      default:
        return [
          {
            ...b,
            props: b.props && "url" in b.props ? { ...b.props, url: absolute(b.props.url) } : b.props,
            children,
          },
        ];
    }
  });
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
