import { apiError, withApiKey } from "@/lib/api/http";
import { MAX_MARKDOWN_BYTES } from "@/lib/api/page-content";
import { type BlockValue, deleteBlock, updateBlock } from "@/lib/api/blocks";
import { blockWriteResponse as answer } from "@/lib/api/grid-input";

type Context = RouteContext<"/api/v1/pages/[pageId]/blocks/[blockId]">;

const isValue = (v: unknown): v is BlockValue =>
  v === null || ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === "string"));

// PATCH { content?, props? }: the block's text (inline Markdown; a code block's
// as it is; a table cell's value) and/or its settings. Its id, type and nested
// blocks stay.
export async function PATCH(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, blockId } = await ctx.params;
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES + 64 * 1024) return apiError("too_large");
    let input: { content?: unknown; props?: unknown };
    try {
      input = JSON.parse(text);
    } catch {
      return apiError("invalid_body", "The body isn't valid JSON.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return apiError("invalid_body", "The body must be a JSON object.");
    if (input.content !== undefined && !isValue(input.content)) return apiError("invalid_body", "\"content\" must be text, a number, true/false, a list of text, or null.");
    if (input.props !== undefined && (!input.props || typeof input.props !== "object" || Array.isArray(input.props))) {
      return apiError("invalid_body", "\"props\" must be an object.");
    }
    return answer(await updateBlock(user.id, pageId, blockId, { content: input.content as BlockValue | undefined, props: input.props as Record<string, unknown> | undefined }));
  });
}

// DELETE: the block, with those nested in it.
export async function DELETE(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, blockId } = await ctx.params;
    return answer(await deleteBlock(user.id, pageId, blockId));
  });
}
