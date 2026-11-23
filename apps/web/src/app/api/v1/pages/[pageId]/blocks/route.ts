import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { MAX_MARKDOWN_BYTES } from "@/lib/api/page-content";
import { MAX_BLOCKS, blockProblem, insertBlocks, listPageBlocks } from "@/lib/api/blocks";

type Context = RouteContext<"/api/v1/pages/[pageId]/blocks">;

const whole = (value: string | null, min: number, max: number) => {
  if (value === null) return undefined;
  const n = /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  return n >= min && n <= max ? n : null;
};

// GET: the page's blocks in order, with their ids, text and the settings that
// can be changed. ?offset= and ?limit= page through them.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    if (!(await getPageAccess(prisma, user.id, pageId))) return apiError("not_found");
    const query = new URL(request.url).searchParams;
    const offset = whole(query.get("offset"), 0, 999_999_999);
    const limit = whole(query.get("limit"), 1, MAX_BLOCKS);
    if (offset === null) return apiError("invalid_body", "\"offset\" must be a whole number, 0 or more.");
    if (limit === null) return apiError("invalid_body", `"limit" must be a whole number from 1 to ${MAX_BLOCKS}.`);
    return apiJson(await listPageBlocks(pageId, { offset, limit }));
  });
}

// POST { blockId, position: "before" | "after", markdown }: new blocks beside
// that one.
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES + 64 * 1024) return apiError("too_large");
    let input: { blockId?: unknown; position?: unknown; markdown?: unknown };
    try {
      input = JSON.parse(text);
    } catch {
      return apiError("invalid_body", "The body isn't valid JSON.");
    }
    if (!input || typeof input !== "object") return apiError("invalid_body", "The body must be a JSON object.");
    const { blockId, position, markdown } = input;
    if (typeof blockId !== "string" || blockId.length === 0 || blockId.length > 64) return apiError("invalid_body", "\"blockId\" must be a block's id.");
    if (position !== "before" && position !== "after") return apiError("invalid_body", "\"position\" must be \"before\" or \"after\".");
    if (typeof markdown !== "string") return apiError("invalid_body", "\"markdown\" must be a string.");
    if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) return apiError("too_large");
    const result = await insertBlocks(user.id, pageId, blockId, position, markdown);
    if ("error" in result) return apiError(result.error);
    if ("problem" in result) return result.problem.code === "blocks_locked" ? apiError("blocks_locked") : apiError("invalid_body", blockProblem(result.problem));
    return apiJson({ ok: true });
  });
}
