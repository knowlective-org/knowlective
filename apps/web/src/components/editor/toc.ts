// The headings a table of contents lists (toc-block.tsx, and the export:
// markdown-export.ts), in the order they're in the page: every heading block,
// nested ones too (in toggles, columns…). No dependencies (unit tests:
// test/toc.test.ts).

type TocSourceBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: TocSourceBlock[] };

export type TocHeading = { id: string; level: number; text: string; content: unknown[] };

export function tocHeadings(blocks: readonly TocSourceBlock[]): TocHeading[] {
  const out: TocHeading[] = [];
  const visit = (list: readonly TocSourceBlock[]) => {
    for (const b of list) {
      if (b.type === "heading" && Array.isArray(b.content)) {
        const text = inlineText(b.content).replace(/\s+/g, " ").trim();
        if (text) out.push({ id: String(b.id ?? ""), level: Math.min(6, Math.max(2, Number(b.props?.level ?? 2))), text, content: b.content });
      }
      visit(b.children ?? []);
    }
  };
  visit(blocks);
  return out;
}

// The text of inline content (links' text, mentions as "@"; names aren't in
// the document).
function inlineText(content: unknown[]): string {
  return content
    .map((item) => {
      const i = item as { type?: string; text?: unknown; content?: unknown };
      if (i.type === "text") return String(i.text ?? "");
      if (i.type === "link" && Array.isArray(i.content)) return inlineText(i.content);
      if (i.type === "mention") return "@";
      return "";
    })
    .join("");
}
