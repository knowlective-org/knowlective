import { apiError, withApiKey } from "@/lib/api/http";
import { deleteGridPart, insertGridRows } from "@/lib/api/blocks";
import { addRowsBody, blockWriteResponse, readBody, wholeParam } from "@/lib/api/grid-input";
import { MAX_GRID_ROWS } from "@/components/editor/grid-table-config";

type Context = RouteContext<"/api/v1/pages/[pageId]/tables/[tableId]/rows">;

// Rows of an extended table, counted from 0 (the header row being row 0).

// POST { rows, at? }: new rows from that index (omitted: at the end).
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, tableId } = await ctx.params;
    const read = await readBody(request, addRowsBody);
    if ("response" in read) return read.response;
    return blockWriteResponse(await insertGridRows(user.id, pageId, tableId, read.body.at ?? null, read.body.rows));
  });
}

// DELETE ?at=&count=: `count` rows (default 1) from that index.
export async function DELETE(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId, tableId } = await ctx.params;
    const query = new URL(request.url).searchParams;
    const at = wholeParam(query.get("at"), 0, MAX_GRID_ROWS);
    const count = wholeParam(query.get("count"), 1, MAX_GRID_ROWS);
    if (at == null) return apiError("invalid_body", `"at" must be a row index from 0 to ${MAX_GRID_ROWS}.`);
    if (count === null) return apiError("invalid_body", `"count" must be a whole number from 1 to ${MAX_GRID_ROWS}.`);
    return blockWriteResponse(await deleteGridPart(user.id, pageId, tableId, "row", at, count ?? 1));
  });
}
