import { atLeast, canEditPage } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { chatMessages, pageChats } from "@/lib/api/chat";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/chat";
import { postChat, siteChatWords } from "@/lib/chat-post";

type Context = RouteContext<"/api/v1/pages/[pageId]/chats/[blockId]/messages">;

// A chat block that's in the page now; anything else is "not found" (the
// same answer as for a page the key's owner can't see).
async function findChat(userId: string, pageId: string, blockId: string) {
  const access = await getPageAccess(prisma, userId, pageId);
  if (!access) return null;
  if (!(await pageChats(pageId)).some((c) => c.id === blockId)) return null;
  return access;
}

const NO_CHAT = "The page doesn't exist, the key's owner can't see it, or it has no chat with that id.";

// GET: the chat's latest messages, oldest first.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId, blockId } = await ctx.params;
    if (!(await findChat(user.id, pageId, blockId))) return apiError("not_found", NO_CHAT);
    return apiJson(await chatMessages(pageId, blockId, (await siteChatWords()).everyone));
  });
}

// POST { text, replyToId? }: posts a message as the key's owner, as in the
// chat block: Markdown, mentions as `<@userId>` (`<@all>` for everyone who
// can open the page). Needs EDIT on the page, which isn't locked, and the
// chat not locked. Those mentioned and those in the chat are notified.
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, blockId } = await ctx.params;
    const access = await findChat(user.id, pageId, blockId);
    if (!access) return apiError("not_found", NO_CHAT);
    if (!atLeast(access.access, "EDIT")) return apiError("forbidden");
    if (!canEditPage(access)) return apiError("page_locked");
    if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
      return apiError("invalid_body", "Send the body as JSON (Content-Type: application/json).");
    }
    const raw = await request.text();
    if (raw.length > MAX_CHAT_MESSAGE_LENGTH * 4 + 1024) return apiError("too_large");
    let body: { text?: unknown; replyToId?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError("invalid_body", "The body isn't valid JSON.");
    }
    if (!body || typeof body !== "object") return apiError("invalid_body");
    if (body.replyToId !== undefined && body.replyToId !== null && typeof body.replyToId !== "string") {
      return apiError("invalid_body", "\"replyToId\" must be a message id or null.");
    }
    const result = await postChat(user.id, pageId, blockId, body.text, (body.replyToId as string | undefined) ?? null, null, await siteChatWords());
    if ("error" in result) {
      const e = result.error;
      switch (e.code) {
        case "locked":
          return apiError("chat_locked");
        case "invalid":
          return apiError("invalid_body", `"text" must be a string of 1 to ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
        case "reply_gone":
          return apiError("invalid_body", "The message replied to isn't in this chat.");
        case "too_many":
          return apiError("rate_limited", "Too many messages at once. Wait a moment and try again.");
        case "everyone_too_soon":
          return apiError("rate_limited", `<@all> can be used once every ${e.minutes} minutes in a chat.`, { "Retry-After": String(e.seconds) });
        case "not_allowed":
          return apiError("forbidden");
      }
    }
    const { messages } = await chatMessages(pageId, blockId, (await siteChatWords()).everyone);
    return apiJson({ message: messages.find((m) => m.id === result.id) ?? { id: result.id } }, 201);
  });
}
