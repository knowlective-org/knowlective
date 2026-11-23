import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { MAX_TABLE_ROWS, readPageTable } from "@/lib/api/page-tables";

type Context = RouteContext<"/api/v1/pages/[pageId]/tables/[tableId]">;

const whole = (value: string | null, min: number, max: number) => {
  if (value === null) return undefined;
  const n = /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  return n >= min && n <= max ? n : null;
};

// GET: one table's values, all of them, or only the columns named with
// ?column=<name> (repeatable). ?offset= and ?limit= page through the rows.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId, tableId } = await ctx.params;
    if (!(await getPageAccess(prisma, user.id, pageId))) return apiError("not_found");
    const query = new URL(request.url).searchParams;
    const offset = whole(query.get("offset"), 0, 999_999_999);
    const limit = whole(query.get("limit"), 1, MAX_TABLE_ROWS);
    if (offset === null) return apiError("invalid_body", "\"offset\" must be a whole number, 0 or more.");
    if (limit === null) return apiError("invalid_body", `"limit" must be a whole number from 1 to ${MAX_TABLE_ROWS}.`);
    const columns = query.getAll("column");
    const table = await readPageTable(user.id, pageId, tableId, { columns: columns.length > 0 ? columns : undefined, offset, limit });
    if (!table) return apiError("not_found", "The page has no such table.");
    if ("unavailable" in table) return apiError("not_found", "This table's pages can't be read by the key's owner.");
    if ("unknown" in table) return apiError("invalid_body", `The table has no column named ${table.unknown.map((n) => JSON.stringify(n)).join(", ")}.`);
    return apiJson(table);
  });
}
