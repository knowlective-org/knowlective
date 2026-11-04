"use server";

import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { canEditPage, loadDataKey } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { cursorColorFor } from "@/lib/cursor-color";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  CHAT_HISTORY,
  isBlockId,
  normalizeChatMessage,
  openChatMessage,
  sealChatMessage,
  type ChatData,
} from "@/lib/chat";

// Chat blocks: reading needs to be able to open the page (public pages too,
// without names), posting needs to be able to edit it (EDIT, not locked).
// A message can't be changed or deleted, by its author or anyone else.

const postLimit = createRateLimiter(60_000, 30);

export async function loadChat(pageId: string, blockId: string): Promise<ChatData | null> {
  // Shown on public pages too.
  const user = await getCurrentUser();
  if (typeof pageId !== "string" || !isBlockId(blockId)) return null;
  const access = await getPageAccess(prisma, user?.id ?? null, pageId);
  if (!access) return null;
  const rows = await prisma.chatMessage.findMany({
    where: { pageId, blockId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_HISTORY,
    select: { id: true, bodyEnc: true, authorId: true, createdAt: true },
  });
  rows.reverse();
  const key = await loadDataKey(prisma);

  // Someone not logged in (a public page) gets no names: people's names and
  // addresses aren't public.
  const names = new Map<string, string>();
  if (user) {
    const ids = [...new Set(rows.map((r) => r.authorId).filter((id): id is string => !!id))];
    const authors = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, emailEnc: true } });
    for (const a of authors) names.set(a.id, await displayName(a));
  }
  const unknown = (await getTranslations("editor.chat"))("unknownUser");

  return {
    messages: rows.map((r) => ({
      id: r.id,
      text: openChatMessage(key, r),
      mine: !!user && r.authorId === user.id,
      author: user ? (r.authorId ? (names.get(r.authorId) ?? unknown) : unknown) : null,
      color: user && r.authorId ? cursorColorFor(r.authorId) : null,
      createdAt: r.createdAt.toISOString(),
    })),
    canPost: !!user && canEditPage(access),
  };
}

export async function postChatMessage(pageId: string, blockId: string, raw: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("editor.chat");
  if (typeof pageId !== "string" || !isBlockId(blockId)) return { error: t("notAllowed") };
  const access = await getPageAccess(prisma, user.id, pageId);
  if (!access || !canEditPage(access)) return { error: t("notAllowed") };
  const text = normalizeChatMessage(raw);
  if (!text) return { error: t("invalid") };
  if (postLimit(user.id) !== null) return { error: t("tooMany") };
  const id = randomUUID();
  const key = await loadDataKey(prisma);
  await prisma.chatMessage.create({ data: { id, pageId, blockId, authorId: user.id, bodyEnc: sealChatMessage(key, id, text) } });
  // Everyone with the page open refetches (with their own access), as for
  // the child page blocks.
  notifyChildrenChanged(pageId);
  return {};
}
