import { apiError, withApiKey } from "@/lib/api/http";
import { deleteGridPart, insertGridColumn } from "@/lib/api/blocks";
import { addColumnBody, blockWriteResponse, readBody, toRule, wholeParam } from "@/lib/api/grid-input";
import { MAX_GRID_COLUMNS } from "@/components/editor/grid-table-config";

type Context = RouteContext<"/api/v1/pages/[pageId]/tables/[tableId]/columns">;

// Columns of an extended table, counted from 0.

// POST { at?, type?, cells? }: one new column at that index (omitted: at the
// right end), with its type and its cells top to bottom.
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, tableId } = await ctx.params;
    const read = await readBody(request, addColumnBody);
    if ("response" in read) return read.response;
    const { at, type, cells } = read.body;
    return blockWriteResponse(await insertGridColumn(user.id, pageId, tableId, at ?? null, cells ?? [], toRule(type)));
  });
}

// DELETE ?at=: the column at that index, with its type and summary.
export async function DELETE(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, tableId } = await ctx.params;
    const at = wholeParam(new URL(request.url).searchParams.get("at"), 0, MAX_GRID_COLUMNS);
    if (at == null) return apiError("invalid_body", `"at" must be a column index from 0 to ${MAX_GRID_COLUMNS}.`);
    return blockWriteResponse(await deleteGridPart(user.id, pageId, tableId, "column", at));
  });
}
