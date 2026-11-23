import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { slideErrorResponse, slideList } from "@/lib/api/slides";
import { addSlideTo } from "@/lib/presentation-ops";

type Context = RouteContext<"/api/v1/pages/[pageId]/slides">;

// GET: a presentation's slides in order, with their number and whether they
// (or only their numbers) are hidden.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    const slides = await slideList(user.id, pageId);
    return slides ? apiJson({ slides }) : apiError("not_found", "The presentation doesn't exist, or the key's owner can't see it.");
  });
}

// POST { afterId? }: a new empty slide after that one (default: at the end).
// Edit its content through …/pages/<slide id>/whiteboard.
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    const text = await request.text();
    let body: { afterId?: unknown } = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return apiError("invalid_body", "The body isn't valid JSON.");
      }
    }
    if (body === null || typeof body !== "object" || (body.afterId !== undefined && typeof body.afterId !== "string")) {
      return apiError("invalid_body", "\"afterId\" must be a slide's id.");
    }
    const result = await addSlideTo(user.id, pageId, (body.afterId as string | undefined) ?? null);
    if (result.error) return slideErrorResponse(result);
    return apiJson({ id: result.id }, 201);
  });
}
