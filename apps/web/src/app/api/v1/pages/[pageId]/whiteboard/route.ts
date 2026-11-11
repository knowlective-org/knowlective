import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { atLeast, canEditPage } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { currentPageState } from "@/lib/api/page-content";
import { changeWhiteboard } from "@/lib/collab-events";
import { readItems } from "@/lib/whiteboard";
import { imageFileIds, planWhiteboardChange } from "@/lib/whiteboard-ops";

type Context = RouteContext<"/api/v1/pages/[pageId]/whiteboard">;

// The largest request body (a batch of items with their text).
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// The board as it is now, or the error to answer with.
async function boardOf(userId: string, pageId: string) {
  const access = await getPageAccess(prisma, userId, pageId);
  if (!access) return apiError("not_found");
  const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { kind: true } });
  if (page.kind !== "WHITEBOARD") return apiError("not_whiteboard");
  const doc = new Y.Doc();
  const state = await currentPageState(pageId);
  if (state) Y.applyUpdate(doc, state);
  return { access, doc };
}

// GET: the board's items, back to front (lib/whiteboard.ts: boxes —
// sticky, rect, ellipse, diamond, text, image —, connectors between boxes,
// and lines).
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    const board = await boardOf(user.id, pageId);
    if (board instanceof Response) return board;
    return apiJson({ items: readItems(board.doc) });
  });
}

// POST { add?: item[], update?: { id, ...fields }[], remove?: id[] }: changes
// the board at once, as the key's owner, in the live document (everyone with
// it open sees it). Needs EDIT on the page, which isn't locked. Added items
// may bring their own id (so connectors in the same request can join them);
// removing a box removes its connectors. An image's `src` must be an
// attachment of this page ("/api/files/<id>").
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    const board = await boardOf(user.id, pageId);
    if (board instanceof Response) return board;
    if (!atLeast(board.access.access, "EDIT")) return apiError("forbidden");
    if (!canEditPage(board.access)) return apiError("page_locked");
    if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
      return apiError("invalid_body", "Send the body as JSON (Content-Type: application/json).");
    }
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return apiError("too_large");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return apiError("invalid_body", "The body isn't valid JSON.");
    }
    const plan = planWhiteboardChange(board.doc, input, randomUUID);
    if ("error" in plan) return apiError("invalid_body", plan.error);
    // Images: attachments of this page only.
    const fileIds = [...new Set(imageFileIds(plan.ops))];
    if (fileIds.length > 0) {
      const files = await prisma.fileObject.count({ where: { id: { in: fileIds }, pageId } });
      if (files !== fileIds.length) return apiError("invalid_body", "An image's \"src\" must be an attachment of this page.");
    }
    await changeWhiteboard(pageId, user.id, plan.ops);
    const after = await boardOf(user.id, pageId);
    return apiJson({ added: plan.added, items: after instanceof Response ? [] : readItems(after.doc) });
  });
}
