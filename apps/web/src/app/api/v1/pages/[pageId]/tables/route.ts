import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { listPageTables } from "@/lib/api/page-tables";
import { createGridTable } from "@/lib/api/blocks";
import { blockWriteResponse, createGridBody, readBody, toRule } from "@/lib/api/grid-input";

type Context = RouteContext<"/api/v1/pages/[pageId]/tables">;

// GET: the tables in the page's body (tables, extended tables and child page
// tables), with their columns and row counts.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    if (!(await getPageAccess(prisma, user.id, pageId))) return apiError("not_found");
    return apiJson({ tables: await listPageTables(user.id, pageId) });
  });
}

// POST { rows, blockId?, position?, headerRow?, headerColumn?, columns? }: a
// new extended table beside that block, or at the end of the page. Answers
// with its id (tableId).
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    const read = await readBody(request, createGridBody);
    if ("response" in read) return read.response;
    const { columns, ...input } = read.body;
    const result = await createGridTable(user.id, pageId, { ...input, columns: (columns ?? []).map(toRule) });
    return blockWriteResponse(result, { tableId: result.tableId });
  });
}
