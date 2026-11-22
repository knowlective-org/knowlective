import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { sendPageMessage } from "@/lib/page-message";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGE_RECIPIENTS } from "@/lib/page-message-text";

type Context = RouteContext<"/api/v1/pages/[pageId]/notifications">;

// POST { userIds, text }: a message about the page, as a notification from
// the key's owner to these people (from …/people; the owner too), with the
// key's name as what sent it, lib/page-message.ts. The text is shown whole,
// with http(s) URLs as links. Needs edit access.
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user, key }) => {
    const { pageId } = await ctx.params;
    if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
      return apiError("invalid_body", "Send the body as JSON (Content-Type: application/json).");
    }
    const raw = await request.text();
    if (raw.length > MAX_MESSAGE_LENGTH * 4 + MAX_MESSAGE_RECIPIENTS * 80 + 1024) return apiError("too_large");
    let body: { userIds?: unknown; text?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError("invalid_body", "The body isn't valid JSON.");
    }
    if (!body || typeof body !== "object") return apiError("invalid_body");
    const result = await sendPageMessage(user.id, `key:${key.id}`, pageId, body.userIds, body.text);
    if ("error" in result) {
      const e = result.error;
      switch (e.code) {
        case "not_found":
          return apiError("not_found");
        case "forbidden":
          return apiError("forbidden");
        case "invalid":
          return apiError("invalid_body", e.message);
        case "unknown_recipients":
          return apiError(
            "invalid_body",
            `These users can't open the page, or can't be sent a message about it (see GET …/people): ${e.userIds.join(", ")}`,
          );
        case "too_many":
          return apiError("rate_limited", "Too many messages at once. Wait a moment and try again.", { "Retry-After": String(e.retryAfter) });
      }
    }
    return apiJson({ recipients: result.recipients });
  });
}
