import { randomUUID } from "node:crypto";
import { atLeast, canEditPage } from "shared";
import { currentPageState, markdownToBody } from "@/lib/api/page-content";
import { type BlockEditError, type DocBlock, type ListedBlock, listBlocks, protectMentions, restoreMentions } from "@/lib/block-edit";
import { type BodyEdit, editPageBody } from "@/lib/collab-events";
import { CHECKED } from "@/components/editor/grid-types";
import { prisma } from "@/lib/db";
import { adoptFilesInBody } from "@/lib/file-copy";
import { bodyToBlocks } from "@/lib/markdown-bridge";
import { getPageAccess } from "@/lib/page-access";
import { pagePeople } from "@/lib/page-people";

// Changing single blocks of a page for the public API and MCP: the access
// checks and what needs the database; the edit itself is lib/block-edit.ts,
// run by the collab server on the live document (with a version of unsaved
// edits kept first, as every API write).

export const DEFAULT_BLOCKS = 500;
export const MAX_BLOCKS = 2000;

export type BlockAccessError = "not_found" | "forbidden" | "page_locked" | "not_document";
export type BlockWriteResult = { error: BlockAccessError } | { problem: BlockEditError } | { ok: true };
export type BlockValue = string | number | boolean | string[] | null;

export async function listPageBlocks(
  pageId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<{ blocks: ListedBlock[]; total: number; offset: number; nextOffset: number | null }> {
  const state = await currentPageState(pageId);
  const all = state ? listBlocks((await bodyToBlocks(state)) as DocBlock[]) : [];
  const offset = options.offset ?? 0;
  const end = offset + Math.min(options.limit ?? DEFAULT_BLOCKS, MAX_BLOCKS);
  return { blocks: all.slice(offset, end), total: all.length, offset, nextOffset: end < all.length ? end : null };
}

async function writable(userId: string, pageId: string): Promise<BlockAccessError | null> {
  const access = await getPageAccess(prisma, userId, pageId);
  if (!access) return "not_found";
  if (!atLeast(access.access, "EDIT")) return "forbidden";
  if (!canEditPage(access)) return "page_locked";
  const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { kind: true } });
  return page.kind === "DOCUMENT" ? null : "not_document";
}

async function toBody(userId: string, pageId: string, markdown: string, people: string[]): Promise<Uint8Array> {
  const { markdown: text, ids } = protectMentions(markdown, people);
  return adoptFilesInBody(userId, pageId, restoreMentions(await markdownToBody(text), ids));
}

// A cell's value as text: a checkbox's mark, options one per line.
function valueText(value: BlockValue): string {
  if (value === null) return "";
  if (value === true) return CHECKED;
  if (value === false) return "";
  return Array.isArray(value) ? value.join("\n") : String(value);
}

// A page a block is pointed at (a linked view's, an embedded whiteboard's):
// only one the person can open, of the right kind.
async function pointsAtReadablePage(userId: string, props: Record<string, unknown>): Promise<string | null> {
  for (const prop of ["source", "pageId"] as const) {
    const id = props[prop];
    if (typeof id !== "string" || id === "") continue;
    const access = await getPageAccess(prisma, userId, id);
    const page = access ? await prisma.page.findUnique({ where: { id }, select: { kind: true } }) : null;
    if (!page || page.kind === "SHORTCUT" || (prop === "pageId" && page.kind !== "WHITEBOARD")) return prop;
  }
  return null;
}

const run = async (pageId: string, userId: string, edit: BodyEdit): Promise<BlockWriteResult> => {
  const problem = await editPageBody(pageId, userId, edit);
  return problem ? { problem: problem as BlockEditError } : { ok: true };
};

export async function updateBlock(
  userId: string,
  pageId: string,
  blockId: string,
  input: { content?: BlockValue; props?: Record<string, unknown> },
): Promise<BlockWriteResult> {
  const denied = await writable(userId, pageId);
  if (denied) return { error: denied };
  if (input.props) {
    const prop = await pointsAtReadablePage(userId, input.props);
    if (prop) return { problem: { code: "invalid_prop", prop, type: "block" } };
  }
  const people = (await pagePeople(prisma, pageId)).map((p) => p.id);
  let content: { text: string; body: Uint8Array } | undefined;
  if (input.content !== undefined) {
    const text = valueText(input.content);
    content = { text, body: await toBody(userId, pageId, text, people) };
  }
  return run(pageId, userId, {
    kind: "block",
    edit: { kind: "update", blockId, content, props: input.props, people, userId, now: new Date().toISOString(), newId: randomUUID() },
  });
}

export async function insertBlocks(
  userId: string,
  pageId: string,
  blockId: string,
  position: "before" | "after",
  markdown: string,
): Promise<BlockWriteResult> {
  const denied = await writable(userId, pageId);
  if (denied) return { error: denied };
  const people = (await pagePeople(prisma, pageId)).map((p) => p.id);
  return run(pageId, userId, { kind: "block", edit: { kind: "insert", blockId, position, body: await toBody(userId, pageId, markdown, people) } });
}

export async function deleteBlock(userId: string, pageId: string, blockId: string): Promise<BlockWriteResult> {
  const denied = await writable(userId, pageId);
  if (denied) return { error: denied };
  return run(pageId, userId, { kind: "block", edit: { kind: "delete", blockId, newId: randomUUID() } });
}

// What's wrong, for the person or app that asked.
export function blockProblem(problem: BlockEditError): string {
  switch (problem.code) {
    case "block_not_found":
      return "The page has no block with that id. Find it with the page's block list.";
    case "blocks_locked":
      return "The block (or one it holds or is in) is locked.";
    case "no_text":
      return `A ${problem.type} block has no text to change; change its settings ("props") instead.`;
    case "not_one_block":
      return "Send the content of one block: text with inline Markdown (a table block: one Markdown table). To add blocks, insert them.";
    case "empty_content":
      return "There's nothing to insert.";
    case "not_a_block":
      return `A ${problem.type} can't be inserted beside or deleted on its own.`;
    case "typed_cell":
      return "This block is the value of a typed table column: change the cell (type gridCell) instead.";
    case "masked_cell":
      return "A masked column's values are sealed in the browser and can't be written here.";
    case "invalid_value":
      return "That isn't a valid value for this column.";
    case "invalid_prop":
      return `"${problem.prop}" can't be set to that on this ${problem.type}.`;
    case "nothing_to_change":
      return "Send \"content\" or \"props\".";
  }
}
