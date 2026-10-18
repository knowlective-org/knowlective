// Turning pasted text and Markdown / text files into the editor's blocks.
// (Word files: docx-import.ts.)

export type ImportKind = "markdown" | "text" | "docx";

// A file larger than this is attached as a file without offering to expand it
// into the page. Word files are mostly their images, which become attachments.
const MAX_IMPORT_BYTES: Record<ImportKind, number> = {
  markdown: 2 * 1024 * 1024,
  text: 2 * 1024 * 1024,
  docx: 50 * 1024 * 1024,
};

// How a file's content can be expanded into the page, or null if it can only
// be attached. Decided by the extension first: browsers report .md files as
// text/markdown, text/plain or nothing, depending on the OS.
export function importKind(file: File): ImportKind | null {
  const kind: ImportKind | null =
    /\.(md|markdown)$/i.test(file.name) || file.type === "text/markdown"
      ? "markdown"
      : /\.txt$/i.test(file.name)
        ? "text"
        : /\.docx$/i.test(file.name)
          ? "docx"
          : null;
  return kind && file.size <= MAX_IMPORT_BYTES[kind] ? kind : null;
}

// The file's text. UTF-8, or Shift_JIS (still common for Japanese .txt files
// made on Windows) when it isn't valid UTF-8.
export async function readTextFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

// A text file as blocks: one paragraph per line, nothing interpreted (a line
// starting with "#" or "-" stays as it is). Blank lines are dropped.
export function textToBlocks(text: string): ImportedBlock[] {
  return text
    .split(/\r\n?|\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => ({ type: "paragraph", content: line }));
}

// First line of a Mermaid diagram: the diagram type alone, or with the few
// things that may follow it. Kept strict so ordinary text that happens to
// start with "graph" or "pie" isn't turned into a diagram.
const MERMAID_FIRST_LINE = new RegExp(
  "^(?:" +
    "(?:graph|flowchart)(?:\\s+(?:TB|TD|BT|RL|LR))?;?" +
    "|pie(?:\\s+showData)?(?:\\s+title\\s.*)?" +
    "|(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|journey|gitGraph|mindmap|timeline" +
    "|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|kanban" +
    "|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta)" +
    ")$",
);

const MERMAID_FENCE = /^```\s*mermaid[^\n]*\n([\s\S]*?)\n```$/;

// The Mermaid source if `text` as a whole is one diagram (bare, or in a
// ```mermaid fence); otherwise null.
export function extractMermaid(text: string): string | null {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  const fenced = MERMAID_FENCE.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const lines = trimmed.split("\n").filter((line) => line.trim() !== "");
  if (lines.length >= 2 && MERMAID_FIRST_LINE.test(lines[0].trim())) return trimmed;
  return null;
}

export type ImportedBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: ImportedBlock[];
};

function isMermaidCodeBlock(block: ImportedBlock): boolean {
  return block.type === "codeBlock" && String(block.props?.language ?? "").toLowerCase() === "mermaid";
}

function plainText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((item) => (typeof item?.text === "string" ? item.text : "")).join("");
}

// ```mermaid code blocks become Mermaid diagram blocks.
export function mermaidFromCodeBlock(block: ImportedBlock): ImportedBlock | null {
  if (!isMermaidCodeBlock(block)) return null;
  return { type: "mermaid", props: { code: plainText(block.content).trim() } };
}

// Blocks parsed from a Markdown file, adjusted for a page: headings move down
// one level (the page title is the only H1; H6 stays), and ```mermaid code
// blocks become diagrams.
export function prepareImportedBlocks(blocks: ImportedBlock[]): ImportedBlock[] {
  return blocks.map((block) => {
    const diagram = mermaidFromCodeBlock(block);
    if (diagram) return diagram;
    const children = block.children ? prepareImportedBlocks(block.children) : block.children;
    if (block.type === "heading") {
      const level = Math.min(Number(block.props?.level ?? 1) + 1, 6);
      return { ...block, props: { ...block.props, level }, children };
    }
    return { ...block, children };
  });
}
