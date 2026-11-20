// A message about a page sent through the API or MCP (lib/page-message.ts):
// its limits, and its text cut into plain text and links for the
// notification list. Shared with the notifier (server/notifications.ts) —
// keep dependency-free (unit tests: test/page-message-text.test.ts).

export const MAX_MESSAGE_LENGTH = 2000;
// People one message can go to.
export const MAX_MESSAGE_RECIPIENTS = 100;

export type MessagePart = { text: string; href?: string };

// Bare http(s) URLs become links; anything else (javascript:, data:, …) stays
// text. Punctuation closing a sentence isn't taken into the URL.
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const pattern = /https?:\/\/[^\s<>"'「」『』（）、。]+/gi;
  let last = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    let url = m[0].replace(/[.,;:!?)\]}]+$/, "");
    // "(see https://x/(a))": keep a closing parenthesis that has its opening one.
    const tail = m[0].slice(url.length);
    if (tail.startsWith(")") && url.split("(").length > url.split(")").length) url += ")";
    if (!isHttpUrl(url)) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: url, href: url });
    last = m.index + url.length;
    pattern.lastIndex = last;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}
