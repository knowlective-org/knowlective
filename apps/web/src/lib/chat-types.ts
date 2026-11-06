// What the chat block (browser) and its Server Actions share about messages
// (lib/chat.ts). Keep dependency-free: the block is client code.

export const MAX_CHAT_MESSAGE_LENGTH = 4000;
// The latest this many are shown.
export const CHAT_HISTORY = 300;

// The message a reply answers, as quoted above it. `missing`: it's gone (the
// reply's own row is kept).
export type ChatReplyView = { id: string; author: string | null; excerpt: string; deleted: boolean };

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
};

// `canPost`: the viewer can edit the page and the chat isn't locked.
// `canLock`: they can edit the page (and so lock or unlock the chat).
export type ChatData = { messages: ChatMessageView[]; canPost: boolean; locked: boolean; canLock: boolean };

// How much of the message a reply quotes.
export const REPLY_EXCERPT_LENGTH = 80;
