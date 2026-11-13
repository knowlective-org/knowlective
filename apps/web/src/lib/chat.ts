import { decrypt, encrypt } from "shared";

// Messages of chat blocks (components/editor/chat-block.tsx; Server Actions in
// (app)/pages/[pageId]/chat-actions.ts). Stored as ChatMessage rows, not in
// the page document, so nobody but the server can change one (the server lets
// a message's author change its text, marking it edited, or take it back,
// emptying it and leaving only that it was taken back); the text is
// encrypted with the data key, bound to its row by the AAD.

export {
  CHAT_HISTORY,
  CHAT_IMAGE_TYPES,
  CHAT_REACTIONS,
  isChatReaction,
  MAX_CHAT_FILES,
  normalizeChatFileIds,
  type ChatFileView,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MIN_POLL_OPTIONS,
  normalizePollOptions,
  normalizePollVote,
  REPLY_EXCERPT_LENGTH,
  type ChatData,
  type ChatMessageView,
  type ChatPollView,
  type ChatReactionView,
} from "./chat-types";
import { MAX_CHAT_MESSAGE_LENGTH } from "./chat-types";

const aad = (id: string) => `knowlective:chat-message:${id}`;

export function sealChatMessage(key: Uint8Array, id: string, text: string) {
  return Uint8Array.from(encrypt(key, Buffer.from(text, "utf8"), aad(id)));
}

export function openChatMessage(key: Uint8Array, row: { id: string; bodyEnc: Uint8Array }): string {
  return decrypt(key, row.bodyEnc, aad(row.id)).toString("utf8");
}

// A poll's choices (ChatPoll.optionsEnc): a JSON array of strings, bound to
// its message.
const pollAad = (messageId: string) => `knowlective:chat-poll:${messageId}`;

export function sealPollOptions(key: Uint8Array, messageId: string, options: string[]) {
  return Uint8Array.from(encrypt(key, Buffer.from(JSON.stringify(options), "utf8"), pollAad(messageId)));
}

export function openPollOptions(key: Uint8Array, poll: { messageId: string; optionsEnc: Uint8Array }): string[] {
  const options: unknown = JSON.parse(decrypt(key, poll.optionsEnc, pollAad(poll.messageId)).toString("utf8"));
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

// BlockNote's block ids (UUIDs); anything else isn't a block of ours.
export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

// The message as it's stored: line breaks kept, ends trimmed. Null when empty
// or too long.
export function normalizeChatMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n?/g, "\n").trim();
  return text && text.length <= MAX_CHAT_MESSAGE_LENGTH ? text : null;
}
