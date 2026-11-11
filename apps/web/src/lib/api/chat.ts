import * as Y from "yjs";
import { loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { CHAT_HISTORY, CHAT_REACTIONS, openChatMessage, openPollOptions } from "@/lib/chat";
import { EVERYONE, chatMentionIds, chatMentionsEveryone, chatPlainText } from "@/lib/chat-text";
import { chatMarkdownPlain } from "@/lib/chat-markdown";
import { pagePeopleNames } from "@/lib/page-people";
import { currentPageState } from "./page-content";

// Chats for the public API (/api/v1/pages/<id>/chats…). Access is checked by
// the caller (getPageAccess); a message's text is as stored: Markdown, with
// mentions as `<@userId>` (`<@all>` for everyone) and their names in
// `mentions`.

// The chat blocks in the page's document as it is now, in order: block id
// and title.
export async function pageChats(pageId: string): Promise<{ id: string; title: string }[]> {
  const state = await currentPageState(pageId);
  if (!state) return [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const chats: { id: string; title: string }[] = [];
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === "blockContainer") {
        const id = child.getAttribute("id") as unknown;
        const content = child.toArray()[0];
        if (typeof id === "string" && content instanceof Y.XmlElement && content.nodeName === "chat") {
          const title = content.getAttribute("title") as unknown;
          chats.push({ id, title: typeof title === "string" ? title : "" });
        }
      }
      visit(child);
    }
  };
  visit(doc.getXmlFragment("blocknote"));
  return chats;
}

type Person = { id: string; name: string } | null;

// The chat's latest messages (up to CHAT_HISTORY), oldest first.
export async function chatMessages(pageId: string, blockId: string, everyoneWord: string) {
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
        replyToId: true,
        reactions: { select: { userId: true, emoji: true }, orderBy: { createdAt: "asc" } },
        poll: { select: { messageId: true, multiple: true, optionsEnc: true, closedAt: true, votes: { select: { userId: true, option: true } } } },
      },
    }),
    prisma.chatLock.findUnique({ where: { pageId_blockId: { pageId, blockId } }, select: { lockedAt: true } }),
  ]);
  rows.reverse();
  const key = await loadDataKey(prisma);
  const texts = new Map(rows.map((r) => [r.id, r.deletedAt ? "" : openChatMessage(key, r)]));
  // Names: the authors, those who reacted or voted, and those mentioned who
  // can be mentioned on the page (a mention of anyone else names nobody).
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.authorId) ids.add(r.authorId);
    for (const x of r.reactions) ids.add(x.userId);
    for (const v of r.poll?.votes ?? []) ids.add(v.userId);
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, emailEnc: true } });
  const names = new Map<string, string>();
  for (const u of users) names.set(u.id, await displayName(u));
  const mentionable = [...texts.values()].some((t) => chatMentionIds(t).length > 0) ? await pagePeopleNames(prisma, pageId) : new Map<string, string>();
  const person = (id: string | null): Person => (id ? { id, name: names.get(id) ?? "" } : null);

  return {
    locked: !!lock,
    messages: rows.map((r) => {
      const text = texts.get(r.id)!;
      const mentions: Record<string, string> = {};
      for (const id of chatMentionIds(text)) if (mentionable.has(id)) mentions[id] = mentionable.get(id)!;
      if (chatMentionsEveryone(text)) mentions[EVERYONE] = everyoneWord;
      return {
        id: r.id,
        author: person(r.authorId),
        text,
        // Without the Markdown marks, mentions as "@name".
        plainText: chatPlainText(chatMarkdownPlain(text), (id) => mentions[id] ?? null, "", everyoneWord),
        mentions,
        replyToId: r.replyToId,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        // Taken back by its author: its text is gone.
        deleted: r.deletedAt !== null,
        reactions: r.deletedAt
          ? []
          : CHAT_REACTIONS.flatMap((emoji) => {
              const by = r.reactions.filter((x) => x.emoji === emoji).map((x) => person(x.userId)!);
              return by.length ? [{ emoji, users: by }] : [];
            }),
        poll:
          r.poll && !r.deletedAt
            ? {
                multiple: r.poll.multiple,
                closed: r.poll.closedAt !== null,
                options: openPollOptions(key, r.poll).map((option, i) => ({
                  text: option,
                  voters: r.poll!.votes.filter((v) => v.option === i).map((v) => person(v.userId)!),
                })),
              }
            : null,
      };
    }),
  };
}
