import * as z from "zod";
import { MAX_GRID_COLUMNS, MAX_GRID_ROWS } from "@/components/editor/grid-table-config";
import { apiError, apiJson } from "./http";
import { MAX_MARKDOWN_BYTES } from "./page-content";
import { type BlockWriteResult, MAX_CELL_LENGTH, blockProblem } from "./blocks";

// What an extended table's writes take, the same for the MCP tools and
// /api/v1: a cell's value is as update_block takes it.

export const cellValue = z.union([z.string().max(MAX_CELL_LENGTH), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()]);

export const columnRule = z
  .union([
    z.null(),
    z.object({ type: z.literal("text") }),
    z.object({
      type: z.literal("number"),
      grouping: z.boolean().optional().describe("Thousands separators (default: true)"),
      decimals: z.number().int().min(0).max(6).nullable().optional().describe("Decimals shown (default: as typed)"),
    }),
    z.object({ type: z.enum(["date", "checkbox", "user", "masked"]) }),
    z.object({
      type: z.literal("select"),
      multiple: z.boolean().optional().describe("More than one option per cell"),
      options: z.array(z.string().min(1).max(100)).max(50).describe("The options' names"),
    }),
  ])
  .describe("A column's type; null or text: any blocks");

export type ColumnRuleInput = z.infer<typeof columnRule>;

// To the rule a gridTable keeps (grid-types.ts checks it again).
export function toRule(rule: ColumnRuleInput | undefined): unknown {
  if (!rule || rule.type === "text") return null;
  return rule.type === "select" ? { ...rule, options: rule.options.map((name) => ({ name })) } : rule;
}

export const gridRows = z.array(z.array(cellValue).max(MAX_GRID_COLUMNS)).min(1).max(MAX_GRID_ROWS);

export const createGridBody = z.object({
  blockId: z.string().min(1).max(64).optional(),
  position: z.enum(["before", "after"]).optional(),
  rows: gridRows,
  headerRow: z.boolean().optional(),
  headerColumn: z.boolean().optional(),
  columns: z.array(columnRule).max(MAX_GRID_COLUMNS).optional(),
});

export const addRowsBody = z.object({
  at: z.number().int().min(0).max(MAX_GRID_ROWS).optional(),
  rows: gridRows,
});

export const addColumnBody = z.object({
  at: z.number().int().min(0).max(MAX_GRID_COLUMNS).optional(),
  type: columnRule.optional(),
  cells: z.array(cellValue).max(MAX_GRID_ROWS).optional(),
});

// A JSON body checked against the schema, or the error to answer with.
export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<{ body: z.infer<T> } | { response: Response }> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES + 64 * 1024) return { response: apiError("too_large") };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { response: apiError("invalid_body", "The body isn't valid JSON.") };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `"${issue.path.join(".")}": ` : "";
    return { response: apiError("invalid_body", `${where}${issue?.message ?? "The body isn't valid."}`) };
  }
  return { body: parsed.data };
}

// A query parameter as a whole number in the range: undefined when missing,
// null when not one.
export function wholeParam(value: string | null, min: number, max: number): number | null | undefined {
  if (value === null) return undefined;
  const n = /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  return n >= min && n <= max ? n : null;
}

export function blockWriteResponse(result: BlockWriteResult, extra: Record<string, unknown> = {}): Response {
  if ("error" in result) return apiError(result.error);
  if ("problem" in result) {
    if (result.problem.code === "blocks_locked") return apiError("blocks_locked");
    if (result.problem.code === "block_not_found") return apiError("not_found", blockProblem(result.problem));
    return apiError("invalid_body", blockProblem(result.problem));
  }
  return apiJson({ ok: true, ...extra });
}
