"use server";

import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { canEditPage, loadDataKey } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { reindexPage } from "@/lib/search-index";
import { notifyChatPosted } from "@/lib/notification-bridge";
import { cursorColorFor } from "@/lib/cursor-color";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  CHAT_HISTORY,
  REPLY_EXCERPT_LENGTH,
  isBlockId,
  normalizeChatMessage,
  openChatMessage,
  sealChatMessage,
  type ChatData,
} from "@/lib/chat";
import { chatMentionIds, chatPlainText } from "@/lib/chat-text";
import { pagePeopleNames } from "@/lib/page-people";

// Chat blocks: reading needs to be able to open the page (public pages too,
// without names), posting needs to be able to edit it (EDIT, not locked).
// A message's author can change its text (with the same access as posting),
// which marks it edited, or take it back: its text is emptied and it shows
// as taken back ("unsent"), its row kept. Nobody else can do either.
// A message can reply to another in the same chat, and mention people
// (`<@id>`, lib/chat-text.ts; they're notified). Someone who can edit the
// page can lock the chat (ChatLock): then nobody can post, change or take
// back messages in it until it's unlocked.

const postLimit = createRateLimiter(60_000, 30);

async function namesOf(ids: Iterable<string>): Promise<Map<string, string>> {
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, emailEnc: true } });
  const names = new Map<string, string>();
  for (const p of people) names.set(p.id, await displayName(p));
  return names;
}

export async function loadChat(pageId: string, blockId: string): Promise<ChatData | null> {
  // Shown on public pages too.
  const user = await getCurrentUser();
  if (typeof pageId !== "string" || !isBlockId(blockId)) return null;
  const access = await getPageAccess(prisma, user?.id ?? null, pageId);
  if (!access) return null;
  const [rows, lock] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { pageId, blockId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_HISTORY,
      select: {
        id: true,
        bodyEnc: true,
        authorId: true,
        createdAt: true,
        editedAt: true,
        deletedAt: true,
        replyTo: { select: { id: true, bodyEnc: true, authorId: true, deletedAt: true } },
      },
    }),
    prisma.chatLock.findUnique({ where: { pageId_blockId: { pageId, blockId } }, select: { lockedAt: true } }),
  ]);
  rows.reverse();
  const key = await loadDataKey(prisma);
  const open = (r: { id: string; bodyEnc: Uint8Array; deletedAt: Date | null }) => (r.deletedAt ? "" : openChatMessage(key, r));
  const texts = new Map(rows.map((r) => [r.id, open(r)]));
  // The messages replied to (some may be older than the ones shown).
  const quoted = new Map<string, string>();
  for (const r of rows) if (r.replyTo) quoted.set(r.replyTo.id, texts.get(r.replyTo.id) ?? open(r.replyTo));

  // Someone not logged in (a public page) gets no names: people's names and
  // addresses aren't public. Names: the authors (of the quoted messages too)
  // and those mentioned — only those who can be mentioned on the page
  // (lib/page-people.ts): a mention of anyone else names nobody.
  let names = new Map<string, string>();
  if (user) {
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.authorId) ids.add(r.authorId);
      if (r.replyTo?.authorId) ids.add(r.replyTo.authorId);
    }
    const mentioned = [...texts.values(), ...quoted.values()].some((text) => chatMentionIds(text).length > 0);
    const [authors, people] = await Promise.all([namesOf(ids), mentioned ? pagePeopleNames(prisma, pageId) : new Map<string, string>()]);
    names = new Map([...people, ...authors]);
  }
  const unknown = (await getTranslations("editor.chat"))("unknownUser");
  const authorName = (id: string | null) => (user ? (id ? (names.get(id) ?? unknown) : unknown) : null);
  const canEdit = !!user && canEditPage(access);

  return {
    messages: rows.map((r) => {
      const text = texts.get(r.id)!;
      const reply = r.replyTo;
      return {
        id: r.id,
        text,
        mine: !!user && r.authorId === user.id,
        author: authorName(r.authorId),
        color: user && r.authorId ? cursorColorFor(r.authorId) : null,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        deleted: r.deletedAt !== null,
        replyTo: reply
          ? {
              id: reply.id,
              author: authorName(reply.authorId),
              excerpt: chatPlainText(quoted.get(reply.id)!, (id) => names.get(id) ?? null, unknown).slice(0, REPLY_EXCERPT_LENGTH),
              deleted: reply.deletedAt !== null,
            }
          : null,
        names: Object.fromEntries(chatMentionIds(text).flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : []))),
      };
    }),
    canPost: canEdit && !lock,
    locked: !!lock,
    canLock: canEdit,
  };
}

async function chatLocked(pageId: string, blockId: string): Promise<boolean> {
  return !!(await prisma.chatLock.findUnique({ where: { pageId_blockId: { pageId, blockId } }, select: { pageId: true } }));
}

// `replyToId`: the message it replies to, in the same chat (or null).
export async function postChatMessage(
  pageId: string,
  blockId: string,
  raw: string,
  replyToId: string | null = null,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  if (typeof pageId !== "string" || !isBlockId(blockId)) return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, user.id, pageId);
  if (!access || !canEditPage(access)) return { error: t("notAllowed") };
  if (await chatLocked(pageId, blockId)) return { error: t("lockedError") };
  const text = normalizeChatMessage(raw);
  if (!text) return { error: t("invalid") };
  if (replyToId !== null) {
    const replied =
      typeof replyToId === "string"
        ? await prisma.chatMessage.findUnique({ where: { id: replyToId }, select: { pageId: true, blockId: true } })
        : null;
    if (replied?.pageId !== pageId || replied.blockId !== blockId) return { error: t("replyGone") };
  }
  if (postLimit(user.id) !== null) return { error: t("tooMany") };
  const id = randomUUID();
  const key = await loadDataKey(prisma);
  await prisma.chatMessage.create({
    data: { id, pageId, blockId, authorId: user.id, bodyEnc: sealChatMessage(key, id, text), replyToId },
  });
  // Messages are searched with the page.
  await reindexPage(prisma, pageId);
  // Everyone with the page open refetches (with their own access), as for
  // the child page blocks.
  notifyChildrenChanged(pageId);
  // Those in the chat are notified (not waited for); those it mentions, of
  // the mention: only those who can be mentioned on the page. The excerpt
  // shows mentions by name.
  const names = chatMentionIds(text).length > 0 ? await pagePeopleNames(prisma, pageId) : new Map<string, string>();
  const mentionIds = chatMentionIds(text).filter((id) => names.has(id));
  const excerpt = chatPlainText(text, (mentioned) => names.get(mentioned) ?? null, t("unknownUser"));
  void notifyChatPosted({ pageId, blockId, actorId: user.id, text: excerpt, mentionIds });
  return {};
}

// Locking stops posting, changing and taking back messages in the chat, for
// everyone; anyone who can edit the page can lock and unlock it.
export async function setChatLocked(pageId: string, blockId: string, locked: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  if (typeof pageId !== "string" || !isBlockId(blockId) || typeof locked !== "boolean") return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, user.id, pageId);
  if (!access || !canEditPage(access)) return { error: t("notAllowed") };
  if (locked) {
    await prisma.chatLock.upsert({
      where: { pageId_blockId: { pageId, blockId } },
      create: { pageId, blockId, lockedById: user.id },
      update: {},
    });
  } else {
    await prisma.chatLock.deleteMany({ where: { pageId, blockId } });
  }
  notifyChildrenChanged(pageId);
  return {};
}

// The author changes a message's text. Same access as posting (EDIT, the
// page not locked): someone who could post then but can't now can't edit.
export async function editChatMessage(messageId: string, raw: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  const message = await ownMessage(user.id, messageId);
  if (!message) return { error: t("notAllowed") };
  const text = normalizeChatMessage(raw);
  if (!text) return { error: t("invalid") };
  if (postLimit(user.id) !== null) return { error: t("tooMany") };
  const key = await loadDataKey(prisma);
  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { bodyEnc: sealChatMessage(key, messageId, text), editedAt: new Date() },
  });
  await reindexPage(prisma, message.pageId);
  notifyChildrenChanged(message.pageId);
  return {};
}

// The author takes a message back: its text is replaced by an empty one (so
// it's gone from the database, not just hidden) and it shows as taken back.
export async function deleteChatMessage(messageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  const message = await ownMessage(user.id, messageId);
  if (!message) return { error: t("notAllowed") };
  const key = await loadDataKey(prisma);
  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { bodyEnc: sealChatMessage(key, messageId, ""), deletedAt: new Date() },
  });
  await reindexPage(prisma, message.pageId);
  notifyChildrenChanged(message.pageId);
  return {};
}

// A message `userId` wrote and may still change: not taken back, the chat
// not locked, and the page still editable by them (EDIT, not locked), as for
// posting. Someone else's message and a missing one are both null.
async function ownMessage(userId: string, messageId: unknown) {
  if (typeof messageId !== "string") return null;
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { pageId: true, blockId: true, authorId: true, deletedAt: true },
  });
  if (!message || message.authorId !== userId || message.deletedAt) return null;
  if (await chatLocked(message.pageId, message.blockId)) return null;
  const access = await getPageAccess(prisma, userId, message.pageId);
  return access && canEditPage(access) ? message : null;
}
