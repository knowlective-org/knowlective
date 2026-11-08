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
