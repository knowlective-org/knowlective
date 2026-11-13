// What the chat block (browser) and its Server Actions share about messages
// (lib/chat.ts). Keep dependency-free: the block is client code.

export const MAX_CHAT_MESSAGE_LENGTH = 4000;
// The latest this many are shown.
export const CHAT_HISTORY = 300;

// The message a reply answers, as quoted above it. `missing`: it's gone (the
// reply's own row is kept).
export type ChatReplyView = { id: string; author: string | null; excerpt: string; deleted: boolean };

// The emoji a message can be reacted with (the server takes no others).
// "了解" (👌 🙆) and "ありがとう" (🙏 🙇) first. Removing one hides what was
// given with it (the rows stay); adding one needs no migration.
export const CHAT_REACTIONS = ["👍", "👌", "🙆", "🙏", "🙇", "✅", "❤️", "😂", "🎉", "😮", "👀", "💯"] as const;
export type ChatReactionEmoji = (typeof CHAT_REACTIONS)[number];

export function isChatReaction(value: unknown): value is ChatReactionEmoji {
  return typeof value === "string" && (CHAT_REACTIONS as readonly string[]).includes(value);
}

// One emoji's reactions to a message: how many, whether the viewer is one of
// them, and who (null for someone not logged in: names aren't public).
export type ChatReactionView = { emoji: ChatReactionEmoji; count: number; mine: boolean; names: string[] | null };

// Polls: a message whose text is the question, with these choices.
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_OPTION_LENGTH = 100;

// The choices as they're stored: each on one line, ends trimmed. Null unless
// there are MIN..MAX of them, none empty, too long or the same as another.
export function normalizePollOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    const text = value.replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_POLL_OPTION_LENGTH) return null;
    if (options.some((o) => o.normalize("NFKC").toLowerCase() === text.normalize("NFKC").toLowerCase())) return null;
    options.push(text);
  }
  return options.length >= MIN_POLL_OPTIONS && options.length <= MAX_POLL_OPTIONS ? options : null;
}

// A person's choices in a poll: indexes of its `count` choices, each once,
// in order. Null when one isn't a choice, or more than one in a poll that
// takes only one. Empty: no vote (taken back).
export function normalizePollVote(raw: unknown, count: number, multiple: boolean): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((i) => Number.isInteger(i) && i >= 0 && i < count)) return null;
  const choices = [...new Set(raw as number[])].sort((a, b) => a - b);
  return multiple || choices.length <= 1 ? choices : null;
}

// One choice of a poll as a viewer sees it: how many chose it, whether the
// viewer did, and who (null for someone not logged in: names aren't public).
export type ChatPollOptionView = { text: string; count: number; mine: boolean; names: string[] | null };

export type ChatPollView = {
  multiple: boolean;
  closed: boolean;
  options: ChatPollOptionView[];
  // How many people voted.
  voters: number;
};

// Files sent with a message (attachments of the page, uploaded with
// POST /api/files like a file block's): at most this many.
export const MAX_CHAT_FILES = 10;

// Images /api/files shows in the page (its INLINE_TYPES): shown as pictures
// in a message; any other file is a link to download it.
export const CHAT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;

// A message's file. `url` is "/api/files/<id>" (without the base path).
export type ChatFileView = { id: string; url: string; name: string; size: number; image: boolean };

// The file ids a message is sent with: distinct, at most MAX_CHAT_FILES.
// Null when it isn't such a list (whose files they are is checked by the server).
export function normalizeChatFileIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CHAT_FILES) return null;
  if (!raw.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))) return null;
  return new Set(raw).size === raw.length ? (raw as string[]) : null;
}

// What one viewer sees of a message. `author` is null for someone not logged
// in (a public page): people's names aren't public. Mentions are `<@id>` in
// `text` (lib/chat-text.ts); `names` has the names of those it mentions
// (empty for someone not logged in).
export type ChatMessageView = {
  id: string;
  text: string;
  mine: boolean;
  author: string | null;
  color: string | null;
  createdAt: string;
  // When its author last changed it; null if never.
  editedAt: string | null;
  // Taken back by its author: `text` is empty, and only that is shown.
  deleted: boolean;
  replyTo: ChatReplyView | null;
  names: Record<string, string>;
  // In CHAT_REACTIONS' order; none on a message taken back.
  reactions: ChatReactionView[];
  // A poll (the text is its question); none on a message taken back.
  poll: ChatPollView | null;
  // Files sent with it (`text` may then be empty); none on a message taken back.
  files: ChatFileView[];
};

// `canPost`: the viewer can edit the page and the chat isn't locked.
// `canLock`: they can edit the page (and so lock or unlock the chat).
export type ChatData = { messages: ChatMessageView[]; canPost: boolean; locked: boolean; canLock: boolean };

// How much of the message a reply quotes.
export const REPLY_EXCERPT_LENGTH = 80;
