import { randomUUID } from "node:crypto";
import { canEditPage, loadDataKey } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { reindexPage } from "@/lib/search-index";
import { notifyChatPosted } from "@/lib/notification-bridge";
import { createRateLimiter } from "@/lib/rate-limit";
import { isBlockId, normalizeChatMessage, sealChatMessage, sealPollOptions } from "@/lib/chat";
import { chatMentionIds, chatMentionsEveryone, chatPlainText } from "@/lib/chat-text";
import { chatMarkdownPlain } from "@/lib/chat-markdown";
import { pageAudienceIds, pagePeopleNames } from "@/lib/page-people";
import { translatorFor } from "@/i18n/translator";
import { siteDefaultLocale } from "@/i18n/locale";

// Posting a chat message, for the chat block (Server Actions in
// (app)/pages/[pageId]/chat-actions.ts) and the public API
// (/api/v1/pages/<id>/chats/<block>/messages). Who may: anyone who can edit
// the page (EDIT, not locked), while the chat isn't locked. Errors are codes:
// each caller says them in its own way.

export type ChatPostError =
  | { code: "not_allowed" }
  | { code: "locked" }
  | { code: "invalid" }
  | { code: "reply_gone" }
  | { code: "too_many" }
  | { code: "everyone_too_soon"; minutes: number; seconds: number };

// Posting and changing messages, per person (shared with editChatMessage).
export const postLimit = createRateLimiter(60_000, 30);
const EVERYONE_INTERVAL_MS = 5 * 60_000;
// "@everyone": once per EVERYONE_INTERVAL_MS in a chat.
const everyoneLimit = createRateLimiter(EVERYONE_INTERVAL_MS, 1);

export async function chatLocked(pageId: string, blockId: string): Promise<boolean> {
  return !!(await prisma.chatLock.findUnique({ where: { pageId_blockId: { pageId, blockId } }, select: { pageId: true } }));
}

// `replyToId`: the message it replies to, in the same chat (or null).
// `poll`: the message is a poll's question, with these choices (checked by
// the caller). `names`: how mentions read in the notifications' excerpt.
export async function postChat(
  userId: string,
  pageId: string,
  blockId: string,
  raw: unknown,
  replyToId: string | null,
  poll: { options: string[]; multiple: boolean } | null,
  words: { unknownUser: string; everyone: string },
): Promise<{ id: string } | { error: ChatPostError }> {
  if (typeof pageId !== "string" || !isBlockId(blockId)) return { error: { code: "not_allowed" } };
  const access = await getPageAccess(prisma, userId, pageId);
  if (!access || !canEditPage(access)) return { error: { code: "not_allowed" } };
  if (await chatLocked(pageId, blockId)) return { error: { code: "locked" } };
  const text = normalizeChatMessage(raw);
  if (!text) return { error: { code: "invalid" } };
  if (replyToId !== null) {
    const replied =
      typeof replyToId === "string"
        ? await prisma.chatMessage.findUnique({ where: { id: replyToId }, select: { pageId: true, blockId: true } })
        : null;
    if (replied?.pageId !== pageId || replied.blockId !== blockId) return { error: { code: "reply_gone" } };
  }
  if (postLimit(userId) !== null) return { error: { code: "too_many" } };
  const toEveryone = chatMentionsEveryone(text);
  if (toEveryone) {
    const wait = everyoneLimit(`${pageId}:${blockId}`);
    if (wait !== null) return { error: { code: "everyone_too_soon", minutes: EVERYONE_INTERVAL_MS / 60_000, seconds: wait } };
  }
  const id = randomUUID();
  const key = await loadDataKey(prisma);
  await prisma.chatMessage.create({
    data: {
      id,
      pageId,
      blockId,
      authorId: userId,
      bodyEnc: sealChatMessage(key, id, text),
      replyToId,
      ...(poll && { poll: { create: { multiple: poll.multiple, optionsEnc: sealPollOptions(key, id, poll.options) } } }),
    },
  });
  // Messages are searched with the page (a poll's choices too).
  await reindexPage(prisma, pageId);
  // Everyone with the page open refetches (with their own access), as for
  // the child page blocks.
  notifyChildrenChanged(pageId);
  // Those in the chat are notified (not waited for); those it mentions, of
  // the mention: only those who can be mentioned on the page, or, for
  // everyone, all who can open it. The excerpt shows mentions by name.
  const names = chatMentionIds(text).length > 0 ? await pagePeopleNames(prisma, pageId) : new Map<string, string>();
  const mentionIds = [
    ...new Set([...chatMentionIds(text).filter((m) => names.has(m)), ...(toEveryone ? await pageAudienceIds(prisma, pageId) : [])]),
  ];
  const excerpt = chatPlainText(chatMarkdownPlain(text), (mentioned) => names.get(mentioned) ?? null, words.unknownUser, words.everyone);
  void notifyChatPosted({ pageId, blockId, actorId: userId, text: poll ? `📊 ${excerpt}` : excerpt, mentionIds });
  return { id };
}

// The words for the notifications' excerpt in the site's language (the API
// has no viewer's language).
export async function siteChatWords(): Promise<{ unknownUser: string; everyone: string }> {
  const t = translatorFor(await siteDefaultLocale());
  return { unknownUser: t("editor.chat.unknownUser"), everyone: t("editor.chat.everyone") };
}
