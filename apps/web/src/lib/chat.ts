import { decrypt, encrypt } from "shared";

// Messages of chat blocks (components/editor/chat-block.tsx; Server Actions in
// (app)/pages/[pageId]/chat-actions.ts). Stored as ChatMessage rows, not in
// the page document, so nobody but the server can change one; the text is
// encrypted with the data key, bound to its row by the AAD.

export { CHAT_HISTORY, MAX_CHAT_MESSAGE_LENGTH, type ChatData, type ChatMessageView } from "./chat-types";
import { MAX_CHAT_MESSAGE_LENGTH } from "./chat-types";

const aad = (id: string) => `knowlective:chat-message:${id}`;

export function sealChatMessage(key: Uint8Array, id: string, text: string) {
  return Uint8Array.from(encrypt(key, Buffer.from(text, "utf8"), aad(id)));
}

export function openChatMessage(key: Uint8Array, row: { id: string; bodyEnc: Uint8Array }): string {
  return decrypt(key, row.bodyEnc, aad(row.id)).toString("utf8");
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
