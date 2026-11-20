import { atLeast } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess } from "@/lib/page-access";
import { pagePeople } from "@/lib/page-people";
import { notifyMessageSent } from "@/lib/notification-bridge";
import { createRateLimiter } from "@/lib/rate-limit";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGE_RECIPIENTS } from "@/lib/page-message-text";

// A message about a page, sent through the API or MCP (a script telling
// people a build finished, an AI app asking for a review): a MESSAGE
// notification (server/notifications.ts) with its whole text, links
// included, to the people named. Always about a page: the notification lists
// only show those of pages the person can open, and the page is the context.
//
// Like a mention: the sender needs edit access to the page (not a lock: a
// message doesn't change it), and each recipient must be someone the page
// offers to mention (lib/page-people.ts: can open it, has a name). The
// recipients' own settings decide whether they're told.

export type MessageError =
  | { code: "not_found" }
  | { code: "forbidden" }
  | { code: "invalid"; message: string }
  | { code: "unknown_recipients"; userIds: string[] }
  | { code: "too_many"; retryAfter: number };

// Messages per sender (each one counted once, whoever it goes to).
const sendLimit = createRateLimiter(60_000, 20);

export async function sendPageMessage(
  senderId: string,
  pageId: string,
  userIds: unknown,
  text: unknown,
): Promise<{ recipients: number } | { error: MessageError }> {
  const access = await getPageAccess(prisma, senderId, pageId);
  if (!access) return { error: { code: "not_found" } };
  if (!atLeast(access.access, "EDIT")) return { error: { code: "forbidden" } };
  const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { kind: true } });
  if (page.kind === "SHORTCUT") return { error: { code: "invalid", message: "The page is a shortcut: send the message about the page it opens." } };
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_MESSAGE_LENGTH) {
    return { error: { code: "invalid", message: `"text" must be 1 to ${MAX_MESSAGE_LENGTH} characters.` } };
  }
  if (
    !Array.isArray(userIds) ||
    userIds.length === 0 ||
    userIds.length > MAX_MESSAGE_RECIPIENTS ||
    !userIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
  ) {
    return { error: { code: "invalid", message: `"userIds" must list 1 to ${MAX_MESSAGE_RECIPIENTS} user ids.` } };
  }
  const people = new Set((await pagePeople(prisma, pageId)).map((p) => p.id));
  const ids = [...new Set(userIds as string[])];
  const unknown = ids.filter((id) => !people.has(id));
  if (unknown.length > 0) return { error: { code: "unknown_recipients", userIds: unknown } };
  const retryAfter = sendLimit(senderId);
  if (retryAfter !== null) return { error: { code: "too_many", retryAfter } };
  await notifyMessageSent({ pageId, actorId: senderId, recipientIds: ids, text });
  return { recipients: ids.filter((id) => id !== senderId).length };
}
