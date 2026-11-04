// What the chat block (browser) and its Server Actions share about messages
// (lib/chat.ts). Keep dependency-free: the block is client code.

export const MAX_CHAT_MESSAGE_LENGTH = 4000;
// The latest this many are shown.
export const CHAT_HISTORY = 300;

// What one viewer sees of a message. `author` is null for someone not logged
// in (a public page): people's names aren't public.
export type ChatMessageView = {
  id: string;
  text: string;
  mine: boolean;
  author: string | null;
  color: string | null;
  createdAt: string;
};

export type ChatData = { messages: ChatMessageView[]; canPost: boolean };
