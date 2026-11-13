import type { ChildPageItem } from "@/lib/page-property-types";
// Relative: also loaded by the custom server (server/page-markdown.ts).
import { displayTitle } from "../../lib/page-title";
import { sortChildPages } from "../../lib/child-sort";
import { isLinkedView, linkedSource } from "../../lib/linked-views";
import { type TocHeading, tocHeadings } from "./toc";
import { parseSummary, roundSummary, summaryValue } from "./grid-summary";

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
      b.type === "childCalendar" ||
      hasChildPageBlocks(b.children ?? []),
  );
}

// The pages the blocks' linked views (lib/linked-views.ts) show the child
// pages of, other than `pageId` itself: their child pages are loaded for the
// export too (`linkedChildPages`).
export function exportLinkedSources(blocks: ExportBlock[], pageId: string): string[] {
  const ids = new Set<string>();
  const visit = (list: ExportBlock[]) => {
    for (const b of list) {
      const id = linkedSource(b.props?.source);
      if (id && id !== pageId) ids.add(id);
      visit(b.children ?? []);
    }
  };
  visit(blocks);
  return [...ids];
}

function childPageList(
  pages: ChildPageItem[],
  parentId: string,
  levels: number,
  origin: string,
  untitled: string,
): ExportBlock[] {
  return pages
    .filter((page) => page.parentId === parentId)
    .map((page) =>
      block("bulletListItem", [link(`${origin}/pages/${page.id}`, displayTitle(page.title, untitled))], {
        children: levels > 1 ? childPageList(pages, page.id, levels - 1, origin, untitled) : [],
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
//   exporting user can see (the table's columns and the board's lanes are left out);
//   a linked view's, those of its page (`linkedChildPages`, by page id)
// - Columns → their blocks one after another (first column first)
// - Extended table → a table of the cells' text (their blocks' text one after
//   another; what has no text, such as an image, as a link to it)
// - Masked text → a placeholder: the text is only ever opened on screen
// - Chat → left out (its messages aren't in the document)
// - Whiteboard → a link to its page (the title isn't in the document: the
//   link reads `whiteboard`)
// - Table of contents → a list of the page's headings, indented by level
// - TODO → a check list item, with its due date after the text (not the
//   assignee: the document has only their id)
// - Mention → "@name" (with `people`; "@" alone without)
// and with links to attachments made absolute, so they work outside the site.
export function prepareBlocksForExport(
  blocks: ExportBlock[],
  options: {
    origin: string;
    pageId: string;
    childPages: ChildPageItem[] | null;
    // The pages below each linked view's page that the reader can see
    // (exportLinkedSources()); missing: none shown.
    linkedChildPages?: Record<string, ChildPageItem[]>;
    // Shown for a child page without a title, in the viewer's language.
    untitled: string;
    mermaid?: "code" | "keep";
    // Names for mentions, by user id.
    people?: Record<string, string>;
    // A whiteboard block's link text, in the viewer's language.
    whiteboard?: string;
    // The whole page's headings, for tables of contents (found from the
    // blocks given at the top).
    headings?: TocHeading[];
  },
): ExportBlock[] {
  if (!options.headings) options = { ...options, headings: tocHeadings(blocks) };
  const { origin, pageId, childPages, untitled } = options;
  const absolute = (url: unknown) => (typeof url === "string" && url.startsWith("/") ? origin + url : url);

  return blocks.flatMap((original): ExportBlock[] => {
    const b = original.content === undefined ? original : { ...original, content: withMentionsAsText(original.content, options.people ?? {}) };
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
      case "columnList":
      case "column":
        return children;
      case "gridTable":
        return [gridTableAsTable(b, children)];
      case "chat":
        return children;
      case "whiteboard": {
        const id = String(b.props?.pageId ?? "");
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return children;
        return [block("paragraph", [link(`${origin}/pages/${id}`, `▦ ${options.whiteboard ?? "Whiteboard"}`)]), ...children];
      }
      case "maskedText":
        return [block("paragraph", [text("🔒 ••••••••")]), ...children];
      case "toc":
        return [...tocList(options.headings ?? [], options.people ?? {}), ...children];
      case "todo": {
        const content = Array.isArray(b.content) ? b.content : [];
        const due = String(b.props?.due ?? "");
        return [
          block("checkListItem", due ? [...content, text(` 📅 ${due}`)] : content, {
            props: { checked: b.props?.checked === true },
            children,
          }),
        ];
      }
      case "childPages":
      case "childTable":
      case "childBoard":
      case "childCalendar": {
        const levels = b.type === "childPages" ? Number(b.props?.depth ?? 1) : 1;
        const title = String(b.props?.title ?? "");
        // A linked view: its page's child pages (none while no page is chosen).
        const source = linkedSource(b.props?.source);
        const linked = b.type !== "childPages" && isLinkedView(b.props?.source) && source !== pageId;
        const parentId = linked ? (source ?? "") : pageId;
        const shown = linked ? (source ? (options.linkedChildPages?.[source] ?? []) : []) : (childPages ?? []);
        // In the block's order for everyone (by title or time; a column keeps the pages' own).
        const pages = sortChildPages(
          shown,
          String(b.props?.sort ?? ""),
          (t) => displayTitle(t, untitled),
          (x, y) => x.localeCompare(y),
        );
        return [
          ...(title ? [block("paragraph", [text(title, { bold: true })])] : []),
          ...childPageList(pages, parentId, levels, origin, untitled),
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

// The headings as a bulleted list, each level below the one before nested
// in it (a lower heading right after a higher one is nested one step only).
function tocList(headings: TocHeading[], people: Record<string, string>): ExportBlock[] {
  const root: ExportBlock[] = [];
  const stack: { level: number; children: ExportBlock[] }[] = [{ level: 1, children: root }];
  for (const h of headings) {
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    const item = block("bulletListItem", withMentionsAsText(h.content, people) as unknown[], { children: [] });
    stack[stack.length - 1].children.push(item);
    stack.push({ level: h.level, children: item.children! });
  }
  return root;
}

// An extended table (its rows and cells already prepared) as BlockNote's
// table, whose cells hold text only.
function gridTableAsTable(table: ExportBlock, rows: ExportBlock[]): ExportBlock {
  const columns = Math.max(1, ...rows.map((row) => row.children?.length ?? 0));
  const cell = (blocks: ExportBlock[]) => ({
    type: "tableCell",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 },
    content: cellText(blocks),
  });
  return block("table", [], {
    content: {
      type: "tableContent",
      columnWidths: Array.from({ length: columns }, () => undefined),
      ...(table.props?.headerRow !== false ? { headerRows: 1 } : {}),
      ...(table.props?.headerColumn === true ? { headerCols: 1 } : {}),
      rows: [
        ...rows.map((row) => {
          const cells = row.children ?? [];
          return { cells: Array.from({ length: columns }, (_, i) => cell(cells[i]?.children ?? [])) };
        }),
        ...summaryRow(table, rows, columns).map((texts) => ({
          cells: texts.map((t) => ({ ...cell([]), content: t ? [text(t, { bold: true })] : [] })),
        })),
      ],
    },
  });
}

// The table's summary row (grid-summary.ts), if it has one: each column's
// function as a spreadsheet names it, and its value.
function summaryRow(table: ExportBlock, rows: ExportBlock[], columns: number): string[][] {
  const specs = parseSummary(table.props?.summary, columns);
  if (!specs) return [];
  const plain = (blocks: ExportBlock[]) =>
    cellText(blocks)
      .map((item) => (item && typeof item === "object" && "text" in item ? String((item as { text: unknown }).text) : ""))
      .join("");
  const body = rows
    .slice(table.props?.headerRow !== false ? 1 : 0)
    .map((row) => Array.from({ length: columns }, (_, i) => plain(row.children?.[i]?.children ?? [])));
  return [
    specs.map((spec, col) => {
      if (!spec) return "";
      const value = summaryValue(spec, body, col);
      const name = spec.fn.toUpperCase() + (spec.criteria !== undefined ? `(${spec.criteria})` : "");
      return `${name}: ${value === null ? "–" : roundSummary(value).toLocaleString()}`;
    }),
  ];
}

// The text of a cell's blocks (nested ones too), one after another.
function cellText(blocks: ExportBlock[]): unknown[] {
  const parts: unknown[][] = [];
  const visit = (list: ExportBlock[]) => {
    for (const b of list) {
      if (Array.isArray(b.content) && b.content.length) parts.push(b.content);
      else if (b.type === "table" || b.type === "gridTable") parts.push([text("…")]);
      else if (typeof b.props?.url === "string" && b.props.url) {
        parts.push([link(b.props.url, String(b.props.name || b.props.caption || b.props.url))]);
      }
      visit(b.children ?? []);
    }
  };
  visit(blocks);
  return parts.flatMap((part, i) => (i === 0 ? part : [text(" "), ...part]));
}

// Mentions in a block's content (inline content, also inside table cells) as
// "@name" text: the exporters don't know our inline content.
function withMentionsAsText(value: unknown, people: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => withMentionsAsText(item, people));
  if (!value || typeof value !== "object") return value;
  const item = value as { type?: unknown; props?: { userId?: unknown } };
  if (item.type === "mention") {
    const name = typeof item.props?.userId === "string" ? people[item.props.userId] : undefined;
    return text(name ? `@${name}` : "@");
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === "object" ? withMentionsAsText(v, people) : v]));
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
