// A chat message's text, as the chat block shows it: links for http(s) URLs,
// and mentions. A mention is kept in the text as `<@user id>` (the name is
// looked up when it's shown, so it follows a change of name, and isn't shown
// to someone not logged in). `<@all>` mentions everyone who can open the
// page (EVERYONE: shown as "@everyone" in the viewer's language).
//
// Dependency-free: the chat block (browser) and the server both use it;
// unit-tested (test/chat-text.test.ts).

export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; userId: string };

const MENTION = /<@([A-Za-z0-9_-]{1,64})>/g;
// A URL runs to the next space or bracket; punctuation at its end isn't part of it.
const URL = /https?:\/\/[^\s<>"'「」『』（）()、。]+/g;
const TRAILING = /[.,;:!?)\]}’”]+$/;

// The id in `<@…>` that means everyone who can open the page (no user has
// it: user ids are cuids).
export const EVERYONE = "all";

export function chatMention(userId: string): string {
  return `<@${userId}>`;
}

// The people a message mentions by name, each once (not everyone).
export function chatMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))].filter((id) => id !== EVERYONE);
}

// Whether a message mentions everyone who can open the page.
export function chatMentionsEveryone(text: string): boolean {
  return [...text.matchAll(MENTION)].some((m) => m[1] === EVERYONE);
}

function links(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(URL)) {
    const href = m[0].replace(TRAILING, "");
    if (!isHttpUrl(href)) continue;
    if (m.index > at) out.push({ type: "text", text: text.slice(at, m.index) });
    out.push({ type: "link", text: href, href });
    at = m.index + href.length;
  }
  if (at < text.length) out.push({ type: "text", text: text.slice(at) });
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new globalThis.URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

export function chatSegments(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(MENTION)) {
    if (m.index > at) out.push(...links(text.slice(at, m.index)));
    out.push({ type: "mention", userId: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(...links(text.slice(at)));
  return out;
}

// The text with mentions as "@name" (`name(id)`; null: someone unnamed,
// `everyone` for everyone), for excerpts (a reply's quote, a notification).
export function chatPlainText(text: string, name: (userId: string) => string | null, unnamed: string, everyone: string = EVERYONE): string {
  return text.replace(MENTION, (_, id: string) => `@${id === EVERYONE ? everyone : (name(id) ?? unnamed)}`);
}

// Whether an "@" at `index` can start a mention: not right after a character
// that can end an email address's local part ("ann@example.com" isn't one, and
// neither is the "@" inside a name such as "Ann@Sales"), so text such as
// "これは@山田" or "(@Ann" still is.
const LOCAL_PART = /[A-Za-z0-9._%+-]/;
export function mentionStartsAt(text: string, index: number): boolean {
  return text[index] === "@" && (index === 0 || !LOCAL_PART.test(text[index - 1]));
}

// The longest name the "@" menu searches for.
export const MAX_MENTION_QUERY = 30;

// The "@"s being typed before the caret that could start a mention: what
// follows each so far (spaces and "@" count: names have them) and where it
// is, farthest first (a name with an "@" in it, "@山田@営", is found from its
// first "@").
export function mentionQueries(value: string, caret: number): { query: string; start: number }[] {
  const before = value.slice(0, caret);
  const out: { query: string; start: number }[] = [];
  for (let i = Math.max(0, caret - MAX_MENTION_QUERY - 1); i < caret; i++) {
    if (!mentionStartsAt(before, i)) continue;
    const query = before.slice(i + 1);
    if (query.includes("\n") || /^\s/.test(query)) continue;
    out.push({ query, start: i });
  }
  return out;
}

// The message box shows mentions as "@name"; `picks` are the people chosen
// from the menu, whose "@name" becomes `<@id>` when sent. Only where a mention
// can start (mentionStartsAt), left to right, the longest name first ("@Ann
// Lee" isn't taken for "@Ann", and "@Ann@Sales" not for a "@Sales" in it).
export function chatTextFromDisplay(display: string, picks: { id: string; name: string }[]): string {
  const names = picks.filter((p) => p.name !== "").sort((a, b) => b.name.length - a.name.length);
  let out = "";
  let i = 0;
  while (i < display.length) {
    const p = mentionStartsAt(display, i) ? names.find((n) => display.startsWith(n.name, i + 1)) : undefined;
    if (p) {
      out += chatMention(p.id);
      i += p.name.length + 1;
    } else {
      out += display[i];
      i += 1;
    }
  }
  return out;
}
