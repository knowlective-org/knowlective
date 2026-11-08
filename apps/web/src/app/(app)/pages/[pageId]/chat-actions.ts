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
  CHAT_REACTIONS,
  REPLY_EXCERPT_LENGTH,
  isBlockId,
  isChatReaction,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MIN_POLL_OPTIONS,
  normalizeChatMessage,
  normalizePollOptions,
  normalizePollVote,
  openChatMessage,
  openPollOptions,
  sealChatMessage,
  sealPollOptions,
  type ChatData,
  type ChatPollView,
  type ChatReactionView,
} from "@/lib/chat";
import { EVERYONE, chatMentionIds, chatMentionsEveryone, chatPlainText } from "@/lib/chat-text";
import { chatMarkdownPlain } from "@/lib/chat-markdown";
import { pageAudienceIds, pagePeopleNames } from "@/lib/page-people";

// Chat blocks: reading needs to be able to open the page (public pages too,
// without names), posting needs to be able to edit it (EDIT, not locked).
// A message's author can change its text (with the same access as posting),
// which marks it edited, or take it back: its text is emptied and it shows
// as taken back ("unsent"), its row kept. Nobody else can do either.
// A message can reply to another in the same chat, and mention people
// (`<@id>`, lib/chat-text.ts; they're notified). Someone who can edit the
// page can lock the chat (ChatLock): then nobody can post, change or take
// back messages in it until it's unlocked. Someone who can post can also
// react to others' messages with an emoji (not to their own, nor to one taken
// back); a lock stops that too.
// A message can be a poll (ChatPoll; its text is the question): its choices
// are fixed when it's posted, and it can't be edited. Someone who can post
// votes (their own poll too) and can change their vote until the poll's
// author closes it, for good. A lock keeps the votes but stops voting and
// closing; taking the poll back deletes it with its votes.
// A message can mention everyone who can open the page (`<@all>`): anyone
// who can post may, at most once per EVERYONE_INTERVAL_MS in a chat.

const postLimit = createRateLimiter(60_000, 30);
const reactLimit = createRateLimiter(60_000, 60);
const EVERYONE_INTERVAL_MS = 5 * 60_000;
const everyoneLimit = createRateLimiter(EVERYONE_INTERVAL_MS, 1);

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
        reactions: { select: { userId: true, emoji: true }, orderBy: { createdAt: "asc" } },
        poll: {
          select: {
            messageId: true,
            multiple: true,
            optionsEnc: true,
            closedAt: true,
            votes: { select: { userId: true, option: true }, orderBy: { createdAt: "asc" } },
          },
        },
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
      for (const reaction of r.reactions) ids.add(reaction.userId);
      for (const vote of r.poll?.votes ?? []) ids.add(vote.userId);
    }
    const mentioned = [...texts.values(), ...quoted.values()].some((text) => chatMentionIds(text).length > 0);
    const [authors, people] = await Promise.all([namesOf(ids), mentioned ? pagePeopleNames(prisma, pageId) : new Map<string, string>()]);
    names = new Map([...people, ...authors]);
  }
  const tChat = await getTranslations("editor.chat");
  const unknown = tChat("unknownUser");
  // "@everyone" isn't anyone's name: shown to all, signed in or not.
  const everyone = tChat("everyone");
  const authorName = (id: string | null) => (user ? (id ? (names.get(id) ?? unknown) : unknown) : null);
  const canEdit = !!user && canEditPage(access);
  // Each emoji's reactions, in CHAT_REACTIONS' order (any other is ignored).
  const reactionsOf = (list: { userId: string; emoji: string }[]): ChatReactionView[] =>
    CHAT_REACTIONS.flatMap((emoji) => {
      const by = list.filter((x) => x.emoji === emoji).map((x) => x.userId);
      if (by.length === 0) return [];
      return [{ emoji, count: by.length, mine: !!user && by.includes(user.id), names: user ? by.map((id) => names.get(id) ?? unknown) : null }];
    });
  // Each choice with who chose it (votes for a choice that isn't there are ignored).
  const pollOf = (poll: NonNullable<(typeof rows)[number]["poll"]>): ChatPollView => ({
    multiple: poll.multiple,
    closed: poll.closedAt !== null,
    options: openPollOptions(key, poll).map((text, i) => {
      const by = poll.votes.filter((v) => v.option === i).map((v) => v.userId);
      return { text, count: by.length, mine: !!user && by.includes(user.id), names: user ? by.map((id) => names.get(id) ?? unknown) : null };
    }),
    voters: new Set(poll.votes.map((v) => v.userId)).size,
  });

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
              excerpt: chatPlainText(chatMarkdownPlain(quoted.get(reply.id)!), (id) => names.get(id) ?? null, unknown, everyone).slice(0, REPLY_EXCERPT_LENGTH),
              deleted: reply.deletedAt !== null,
            }
          : null,
        names: {
          ...Object.fromEntries(chatMentionIds(text).flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : []))),
          ...(chatMentionsEveryone(text) ? { [EVERYONE]: everyone } : {}),
        },
        reactions: r.deletedAt ? [] : reactionsOf(r.reactions),
        poll: r.poll && !r.deletedAt ? pollOf(r.poll) : null,
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
  return post(user.id, pageId, blockId, raw, replyToId, null);
}

// A poll: `question` is its message's text, `options` its choices (fixed
// from now on); `multiple` lets each person choose more than one.
export async function postChatPoll(
  pageId: string,
  blockId: string,
  question: string,
  options: string[],
  multiple: boolean,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  const choices = normalizePollOptions(options);
  if (!choices || typeof multiple !== "boolean") {
    return { error: t("pollInvalid", { min: MIN_POLL_OPTIONS, max: MAX_POLL_OPTIONS, length: MAX_POLL_OPTION_LENGTH }) };
  }
  return post(user.id, pageId, blockId, question, null, { options: choices, multiple });
}

async function post(
  userId: string,
  pageId: string,
  blockId: string,
  raw: string,
  replyToId: string | null,
  poll: { options: string[]; multiple: boolean } | null,
): Promise<{ error?: string }> {
  const t = await getTranslations("editor.chat");
  if (typeof pageId !== "string" || !isBlockId(blockId)) return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, userId, pageId);
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
  if (postLimit(userId) !== null) return { error: t("tooMany") };
  const toEveryone = chatMentionsEveryone(text);
  if (toEveryone) {
    const wait = everyoneLimit(`${pageId}:${blockId}`);
    if (wait !== null) return { error: t("everyoneTooSoon", { minutes: EVERYONE_INTERVAL_MS / 60_000, seconds: wait }) };
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
    ...new Set([...chatMentionIds(text).filter((id) => names.has(id)), ...(toEveryone ? await pageAudienceIds(prisma, pageId) : [])]),
  ];
  const excerpt = chatPlainText(chatMarkdownPlain(text), (mentioned) => names.get(mentioned) ?? null, t("unknownUser"), t("everyone"));
  void notifyChatPosted({ pageId, blockId, actorId: userId, text: poll ? `📊 ${excerpt}` : excerpt, mentionIds });
  return {};
}

// The viewer's vote in a poll: the indexes of the choices they pick, in
// place of any they picked before (none: their vote taken back). The same
// access as posting (EDIT, the page not locked, the chat not locked), until
// the poll is closed.
export async function voteChatPoll(messageId: string, choices: number[]): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  if (typeof messageId !== "string") return { error: t("notAllowed") };
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      pageId: true,
      blockId: true,
      deletedAt: true,
      poll: { select: { messageId: true, multiple: true, optionsEnc: true, closedAt: true } },
    },
  });
  if (!message?.poll || message.deletedAt) return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, user.id, message.pageId);
  if (!access || !canEditPage(access)) return { error: t("notAllowed") };
  if (await chatLocked(message.pageId, message.blockId)) return { error: t("lockedError") };
  if (message.poll.closedAt) return { error: t("pollClosedError") };
  const key = await loadDataKey(prisma);
  const vote = normalizePollVote(choices, openPollOptions(key, message.poll).length, message.poll.multiple);
  if (!vote) return { error: t("pollInvalidVote") };
  if (reactLimit(user.id) !== null) return { error: t("tooMany") };
  // Not closed meanwhile: checked again in the same transaction, the poll's
  // row locked against closing until the vote is in.
  const changed = await prisma.$transaction(async (tx) => {
    const open = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "ChatPoll" WHERE "messageId" = ${messageId} AND "closedAt" IS NULL FOR UPDATE`;
    if (open.length === 0) return false;
    await tx.chatPollVote.deleteMany({ where: { messageId, userId: user.id } });
    if (vote.length > 0) await tx.chatPollVote.createMany({ data: vote.map((option) => ({ messageId, userId: user.id, option })) });
    return true;
  });
  if (!changed) return { error: t("pollClosedError") };
  notifyChildrenChanged(message.pageId);
  return {};
}

// The poll's author closes it: no more votes, for good. The same access as
// changing the message (the chat not locked).
export async function closeChatPoll(messageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  const message = await ownMessage(user.id, messageId);
  if (!message?.poll) return { error: t("notAllowed") };
  await prisma.chatPoll.updateMany({ where: { messageId: message.poll.messageId, closedAt: null }, data: { closedAt: new Date() } });
  notifyChildrenChanged(message.pageId);
  return {};
}

// Adds the viewer's reaction with `emoji` to someone else's message, or
// takes it away (`on` false). The same access as posting (EDIT, the page not
// locked, the chat not locked); not on one's own message, nor one taken back.
export async function setChatReaction(messageId: string, emoji: string, on: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  if (typeof messageId !== "string" || !isChatReaction(emoji) || typeof on !== "boolean") return { error: t("notAllowed") };
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { pageId: true, blockId: true, authorId: true, deletedAt: true },
  });
  if (!message || message.deletedAt) return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, user.id, message.pageId);
  if (!access || !canEditPage(access)) return { error: t("notAllowed") };
  if (message.authorId === user.id) return { error: t("ownReaction") };
  if (await chatLocked(message.pageId, message.blockId)) return { error: t("lockedError") };
  if (reactLimit(user.id) !== null) return { error: t("tooMany") };
  const where = { messageId_userId_emoji: { messageId, userId: user.id, emoji } };
  if (on) await prisma.chatReaction.upsert({ where, create: { messageId, userId: user.id, emoji }, update: {} });
  else await prisma.chatReaction.deleteMany({ where: { messageId, userId: user.id, emoji } });
  notifyChildrenChanged(message.pageId);
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
  // A poll's question and choices are fixed.
  if (!message || message.poll) return { error: t("notAllowed") };
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
// it's gone from the database, not just hidden) and it shows as taken back;
// its reactions go with it, and a poll with its votes.
export async function deleteChatMessage(messageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  const message = await ownMessage(user.id, messageId);
  if (!message) return { error: t("notAllowed") };
  const key = await loadDataKey(prisma);
  await prisma.$transaction([
    prisma.chatMessage.update({
      where: { id: messageId },
      data: { bodyEnc: sealChatMessage(key, messageId, ""), deletedAt: new Date() },
    }),
    prisma.chatReaction.deleteMany({ where: { messageId } }),
    prisma.chatPoll.deleteMany({ where: { messageId } }),
  ]);
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
    select: { pageId: true, blockId: true, authorId: true, deletedAt: true, poll: { select: { messageId: true } } },
  });
  if (!message || message.authorId !== userId || message.deletedAt) return null;
  if (await chatLocked(message.pageId, message.blockId)) return null;
  const access = await getPageAccess(prisma, userId, message.pageId);
  return access && canEditPage(access) ? message : null;
}
