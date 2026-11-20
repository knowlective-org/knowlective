// Review threads beside a page's top-level blocks (components/editor/
// review-pane.tsx, ReviewThread): each is a chat (lib/chat.ts) kept under its
// own key, so it has everything a chat block has (replies, reactions,
// mentions, files, notifications) without being in the document. A chat
// block's key is its block id; a review thread's is the block's id with this
// prefix, so the two never meet. Keep dependency-free.

export const REVIEW_PREFIX = "review_";

// The chat key of the thread about `blockId` (a block id: at most 64 - 7
// characters keeps the key a valid chat key).
export function reviewChatKey(blockId: string): string {
  return `${REVIEW_PREFIX}${blockId}`;
}

// The block a chat key's thread is about; null for a chat block's key.
export function reviewBlockOf(chatKey: string): string | null {
  return chatKey.startsWith(REVIEW_PREFIX) ? chatKey.slice(REVIEW_PREFIX.length) : null;
}

export function isReviewBlockId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,57}$/.test(value);
}

export type ReviewThreadView = {
  blockId: string;
  // Messages not taken back.
  count: number;
  resolved: boolean;
};

export type ReviewThreads = {
  threads: ReviewThreadView[];
  // Edit access, page not locked: may post, resolve and reopen.
  canPost: boolean;
};
