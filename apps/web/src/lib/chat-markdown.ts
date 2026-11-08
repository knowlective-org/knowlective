// Formatting in chat messages: a part of Markdown, read when a message is
// shown. Inline: **bold**, *italic* / _italic_, ~~strikethrough~~, `code`,
// [text](https://…). By line: "- " / "* " lists, "1. " numbered lists,
// "> " quotes, ``` code blocks ```. No headings, tables, images or HTML:
// they stay text. Mentions (`<@id>`, chat-text.ts) and bare http(s) URLs work
// inside formatting; inside code they're text. The message is kept as typed.
//
// The text comes from whoever posted it: this only ever makes the nodes
// below, which the chat block draws as React elements (never HTML), and links
// only to http(s) URLs. Dependency-free (unit tests: test/chat-markdown.test.ts).

import { chatSegments } from "./chat-text";

export type ChatInline =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string }
  | { type: "link"; href: string; children: ChatInline[] }
  | { type: "break" }
  | { type: "bold" | "italic" | "strike"; children: ChatInline[] }
  | { type: "code"; text: string };

export type ChatBlockNode =
  | { type: "paragraph"; children: ChatInline[] }
  | { type: "list"; ordered: boolean; start: number; items: ChatInline[][] }
  | { type: "quote"; children: ChatBlockNode[] }
  | { type: "code"; text: string };

const FENCE = /^\s*```/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function chatBlocks(text: string): ChatBlockNode[] {
  const lines = text.split("\n");
  const out: ChatBlockNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence (or the end)
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
      out.push({ type: "quote", children: chatBlocks(body.join("\n")) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: ChatInline[][] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        const m = pattern.exec(lines[i++])!;
        items.push(chatInline(ordered ? m[2] : m[1]));
      }
      out.push({ type: "list", ordered, start: ordered ? Number(numbered![1]) : 1, items });
      continue;
    }
    // A paragraph: lines up to the next blank line or block.
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !FENCE.test(lines[i]) && !QUOTE.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) {
      body.push(lines[i++]);
    }
    if (body.length > 0) {
      out.push({ type: "paragraph", children: body.flatMap((l, n) => (n === 0 ? chatInline(l) : [{ type: "break" } as ChatInline, ...chatInline(l)])) });
    } else {
      i++; // a blank line
    }
  }
  return out;
}

// Mentions are hidden while the markers are read (an id may hold "_"), as
// characters of Unicode's private use area, then put back in the text.
const MENTION = /<@[A-Za-z0-9_-]{1,64}>/g;
const MASK = 0xe000;

export function chatInline(text: string): ChatInline[] {
  const tokens: string[] = [];
  const masked = text.replace(/[-]/g, "").replace(MENTION, (m) => String.fromCharCode(MASK + tokens.push(m) - 1));
  const unmask = (s: string) => s.replace(/[-]/g, (c) => tokens[c.charCodeAt(0) - MASK] ?? "");
  return parseInline(masked, unmask, true);
}

// Where an underscore or asterisk can open or close italics: not inside a
// word (snake_case stays as it is).
const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

function parseInline(s: string, unmask: (s: string) => string, links: boolean): ChatInline[] {
  const out: ChatInline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(...textNodes(unmask(plain), links));
    plain = "";
  };
  // The inner text between `marker` at `i` and the next one, or null (none,
  // empty, or starting or ending with a space).
  const pair = (i: number, marker: string): string | null => {
    const end = s.indexOf(marker, i + marker.length);
    const inner = end === -1 ? "" : s.slice(i + marker.length, end);
    return inner && inner.trim() === inner ? inner : null;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // `code`
    if (c === "`") {
      const inner = pair(i, "`");
      if (inner !== null) {
        flush();
        out.push({ type: "code", text: unmask(inner) });
        i += inner.length + 2;
        continue;
      }
    }
    // **bold**, ~~strike~~
    const double = s.startsWith("**", i) ? "bold" : s.startsWith("~~", i) ? "strike" : null;
    if (double) {
      const inner = pair(i, s.slice(i, i + 2));
      if (inner !== null) {
        flush();
        out.push({ type: double, children: parseInline(inner, unmask, links) });
        i += inner.length + 4;
        continue;
      }
    }
    // *italic*, _italic_ (not inside a word, so snake_case stays)
    if ((c === "*" || c === "_") && s[i + 1] !== c && !wordChar(s[i - 1])) {
      let end = s.indexOf(c, i + 1);
      while (end !== -1 && (s[end + 1] === c || wordChar(s[end + 1]))) end = s.indexOf(c, end + 1);
      const inner = end === -1 ? "" : s.slice(i + 1, end);
      if (inner && inner.trim() === inner) {
        flush();
        out.push({ type: "italic", children: parseInline(inner, unmask, links) });
        i = end + 1;
        continue;
      }
    }
    // [text](https://…)
    if (links && c === "[") {
      const m = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(s.slice(i));
      if (m && isHttpUrl(m[2])) {
        flush();
        out.push({ type: "link", href: m[2], children: parseInline(m[1], unmask, false) });
        i += m[0].length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

// Plain text: mentions, and bare http(s) URLs as links (not inside a link's text).
function textNodes(text: string, links: boolean): ChatInline[] {
  return chatSegments(text).map((seg): ChatInline =>
    seg.type === "link"
      ? links
        ? { type: "link", href: seg.href, children: [{ type: "text", text: seg.text }] }
        : { type: "text", text: seg.text }
      : seg,
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

// The message without its formatting: the words alone, for search, the
// excerpts of replies and notifications (mentions kept as `<@id>`).
export function chatMarkdownPlain(text: string): string {
  const inline = (nodes: ChatInline[]): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case "text":
            return n.text;
          case "mention":
            return `<@${n.userId}>`;
          case "link":
            return inline(n.children);
          case "break":
            return "\n";
          case "code":
            return n.text;
          default:
            return inline(n.children);
        }
      })
      .join("");
  const block = (b: ChatBlockNode): string =>
    b.type === "paragraph"
      ? inline(b.children)
      : b.type === "list"
        ? b.items.map(inline).join("\n")
        : b.type === "quote"
          ? b.children.map(block).join("\n")
          : b.text;
  return chatBlocks(text).map(block).join("\n");
}

// The formatting buttons and shortcuts of the message box: the text with the
// selection (`start`–`end`) formatted, and the new selection.
export type ChatFormat = "bold" | "italic" | "strike" | "code" | "link" | "bullet" | "numbered" | "quote";

export function applyChatFormat(
  value: string,
  start: number,
  end: number,
  format: ChatFormat,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end);
  const wrap = (before: string, after: string, placeholder: string) => {
    const inner = selected || placeholder;
    return {
      value: value.slice(0, start) + before + inner + after + value.slice(end),
      start: start + before.length,
      end: start + before.length + inner.length,
    };
  };
  switch (format) {
    case "bold":
      return wrap("**", "**", "");
    case "italic":
      return wrap("*", "*", "");
    case "strike":
      return wrap("~~", "~~", "");
    case "code":
      return selected.includes("\n") ? wrap("```\n", "\n```", "") : wrap("`", "`", "");
    case "link": {
      const before = `[${selected}](`;
      const url = "https://";
      const next = value.slice(0, start) + before + url + ")" + value.slice(end);
      // The address selected, to type over.
      return { value: next, start: start + before.length, end: start + before.length + url.length };
    }
    default: {
      // Each line the selection touches gets the prefix.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
      const lines = value.slice(lineStart, lineEnd).split("\n");
      const prefixed = lines.map((l, n) => (format === "bullet" ? "- " : format === "quote" ? "> " : `${n + 1}. `) + l).join("\n");
      const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      return { value: next, start: lineStart + prefixed.length, end: lineStart + prefixed.length };
    }
  }
}
