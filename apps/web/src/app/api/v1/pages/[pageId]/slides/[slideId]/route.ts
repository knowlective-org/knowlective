import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { slideErrorResponse, slideList } from "@/lib/api/slides";
import { approveSlideFiles, moveSlideTo, removeSlide, setSlideFlagFor } from "@/lib/presentation-ops";

type Context = RouteContext<"/api/v1/pages/[pageId]/slides/[slideId]">;

// PATCH { hidden?, numberHidden?, beforeId?, presentationId?, copyFiles? }:
// hides the slide from presenting and the PDF, hides only its number, moves
// it before another slide (null: last), or into another presentation. Its
// files are copied there only if named in `copyFiles` (ids): the others are
// answered as `pendingFiles`, and can be approved later with `copyFiles` alone.
export async function PATCH(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, slideId } = await ctx.params;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return apiError("invalid_body", "The body isn't valid JSON.");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_body");
    const { hidden, numberHidden, beforeId, presentationId, copyFiles } = body;
    if (hidden !== undefined && typeof hidden !== "boolean") return apiError("invalid_body", "\"hidden\" must be true or false.");
    if (numberHidden !== undefined && typeof numberHidden !== "boolean") {
      return apiError("invalid_body", "\"numberHidden\" must be true or false.");
    }
    if (beforeId !== undefined && beforeId !== null && typeof beforeId !== "string") {
      return apiError("invalid_body", "\"beforeId\" must be a slide's id, or null for the end.");
    }
    if (presentationId !== undefined && typeof presentationId !== "string") {
      return apiError("invalid_body", "\"presentationId\" must be a presentation's id.");
    }
    if (copyFiles !== undefined && !(Array.isArray(copyFiles) && copyFiles.every((id) => typeof id === "string"))) {
      return apiError("invalid_body", "\"copyFiles\" must be a list of file ids.");
    }
    const moves = beforeId !== undefined || presentationId !== undefined;
    if (hidden === undefined && numberHidden === undefined && !moves && copyFiles === undefined) {
      return apiError("invalid_body", "Send \"hidden\", \"numberHidden\", \"beforeId\", \"presentationId\" or \"copyFiles\".");
    }
    let deckId = pageId;
    let pendingFiles: { id: string; name: string }[] = [];
    if (hidden !== undefined) {
      const result = await setSlideFlagFor(user.id, deckId, slideId, "hidden", hidden);
      if (result.error) return slideErrorResponse(result);
    }
    if (numberHidden !== undefined) {
      const result = await setSlideFlagFor(user.id, deckId, slideId, "numberHidden", numberHidden);
      if (result.error) return slideErrorResponse(result);
    }
    if (moves) {
      const result = await moveSlideTo(user.id, deckId, slideId, (beforeId as string | null | undefined) ?? null, presentationId ?? deckId, copyFiles ?? []);
      if (result.error) return slideErrorResponse(result);
      pendingFiles = result.pendingFiles;
      deckId = presentationId ?? deckId;
    } else if (copyFiles !== undefined) {
      const result = await approveSlideFiles(user.id, deckId, slideId, copyFiles);
      if (result.error) return slideErrorResponse(result);
      pendingFiles = result.pendingFiles;
    }
    return apiJson({ slides: (await slideList(user.id, deckId)) ?? [], pendingFiles });
  });
}

// DELETE: the slide goes to the trash.
export async function DELETE(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, slideId } = await ctx.params;
    const result = await removeSlide(user.id, pageId, slideId);
    if (result.error) return slideErrorResponse(result);
    return apiJson({ ok: true });
  });
}
