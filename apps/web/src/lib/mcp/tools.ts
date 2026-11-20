import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import * as z from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { atLeast, canEditPage } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess, getVisibleTree, getVisibleTrees } from "@/lib/page-access";
import { pageDetail } from "@/lib/api/http";
import { MAX_MARKDOWN_BYTES, currentPageState, markdownToBody } from "@/lib/api/page-content";
import { chatMessages, pageChats } from "@/lib/api/chat";
import { adoptFilesInBody } from "@/lib/file-copy";
import { changeWhiteboard, editPageBody, replacePageContent } from "@/lib/collab-events";
import { insertChildPage } from "@/lib/page-create";
import { MAX_TITLE_LENGTH, normalizeTitle } from "@/lib/page-title";
import { searchPages, type SnippetPart } from "@/lib/search";
import { resolveShortcuts, shortcutTarget } from "@/lib/shortcuts";
import { getPublicUrl } from "@/lib/site-url";
import { docNotices } from "@/lib/doc-notices";
import { readItems } from "@/lib/whiteboard";
import { imageFileIds, planWhiteboardChange } from "@/lib/whiteboard-ops";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/chat";
import { postChat, siteChatWords } from "@/lib/chat-post";
import type { SectionError } from "@/lib/body-edit";
import { childProperties } from "@/lib/api/child-properties";
import { pagePeople } from "@/lib/page-people";
import { sendPageMessage } from "@/lib/page-message";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGE_RECIPIENTS } from "@/lib/page-message-text";
import type { McpCaller } from "./auth";

// The MCP server's tools. Each acts as the caller (lib/mcp/auth.ts) through
// the same functions as the screens and the public API (/api/v1): the same
// access checks (lib/page-access.ts, canEditPage), page locks, block locks,
// history, search index and notifications. Nothing here decides access by
// itself. A READ caller is offered the reading tools only.
//
// Writes never replace a whole body (lib/body-edit.ts): pages are written by
// creating them, renaming them, adding at the end, or replacing one section.

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (message: string): Result => ({ content: [{ type: "text", text: message }], isError: true });

const NOT_FOUND = "The page doesn't exist, or you can't see it.";
const MAX_LIST = 500;
const MAX_TODOS = 100;

const pageId = z.string().min(1).max(64).describe("The page's id");
const markdown = z
  .string()
  .max(MAX_MARKDOWN_BYTES)
  .describe("Markdown. \"## \" is a level-2 heading (\"# \" becomes one too: the title is the page's only H1); \"- [ ] \" makes a TODO; ```mermaid makes a diagram.");

const snippet = (parts: SnippetPart[] | null) => (parts ? parts.map((p) => (p.hit ? `**${p.text}**` : p.text)).join("") : null);

async function pageUrl(id: string): Promise<string> {
  return `${await getPublicUrl()}/pages/${id}`;
}

// The page as a writer reaches it: visible, a document, editable, not locked.
async function editableDocument(userId: string, id: string): Promise<{ rootId: string } | Result> {
  const access = await getPageAccess(prisma, userId, id);
  if (!access) return fail(NOT_FOUND);
  if (!atLeast(access.access, "EDIT")) return fail("You can't edit this page.");
  if (!canEditPage(access)) return fail("The page is locked.");
  const page = await prisma.page.findUniqueOrThrow({ where: { id }, select: { kind: true } });
  if (page.kind !== "DOCUMENT") return fail("The page isn't a document (a whiteboard or a shortcut).");
  return { rootId: access.rootId };
}

function sectionProblem(error: SectionError): string {
  switch (error.code) {
    case "heading_not_found":
      return "No top-level heading with that text (and level / occurrence) in the page. Read the page with get_page for its headings.";
    case "heading_ambiguous":
      return `${error.count} headings have that text. Pass "level" or "occurrence" (1-based) to choose one.`;
    case "custom_blocks":
      return `The section holds blocks Markdown can't carry back unchanged (${error.types.join(", ")}), so it isn't replaced. Edit it in the page, or add to the page with append_to_page.`;
    case "blocks_locked":
      return "Some blocks in the section are locked.";
  }
}

export function registerTools(server: McpServer, caller: McpCaller) {
  const { userId } = caller;
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "search",
    {
      title: "Search pages",
      description:
        "Search the pages you can open, by words or by meaning (chosen from the query unless `mode` is given): their text, chats and attachments. Returns up to 50 pages with where they matched (**hits** in bold).",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
        mode: z.enum(["keyword", "semantic"]).optional().describe("\"keyword\": pages with every word; \"semantic\": also pages close in meaning"),
      }),
      annotations: readOnly,
    },
    async ({ query, mode }) => {
      const outcome = await searchPages(userId, query, mode);
      const origin = await getPublicUrl();
      return json({
        mode: outcome.mode,
        results: outcome.results.map((r) => ({
          id: r.id,
          title: r.title,
          path: r.path,
          url: `${origin}/pages/${r.id}`,
          snippet: snippet(r.snippet),
          chat: snippet(r.matchedChat),
          file: r.matchedFile ? { name: r.matchedFile.name, snippet: snippet(r.matchedFile.snippet) } : null,
          updatedAt: r.updatedAt,
        })),
      });
    },
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description:
        "The page tree you can see: knowledge roots and their pages, or the pages under `parentId`, down to `depth` levels. A page with more pages below than shown has `more` set (list again with it as `parentId`).",
      inputSchema: z.object({
        parentId: pageId.optional().describe("List the pages under this one (default: from the top of every knowledge root)"),
        depth: z.number().int().min(1).max(10).optional().describe("Levels to go down (default 2)"),
      }),
      annotations: readOnly,
    },
    async ({ parentId, depth = 2 }) => {
      const trees = resolveShortcuts(await getVisibleTrees(prisma, userId));
      const all = trees.flatMap((t) => t.pages.map((p) => ({ ...p, rootId: t.rootId, personal: t.personal })));
      const byId = new Map(all.map((p) => [p.id, p]));
      if (parentId && !byId.has(parentId)) return fail(NOT_FOUND);
      const children = new Map<string, typeof all>();
      for (const p of all) {
        if (p.parentId && byId.has(p.parentId)) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
      }
      const start = parentId ? (children.get(parentId) ?? []) : trees.flatMap((t) => t.entryIds.map((id) => byId.get(id)!));
      const out: unknown[] = [];
      let truncated = false;
      const walk = (pages: typeof all, level: number) => {
        for (const p of pages) {
          if (out.length >= MAX_LIST) {
            truncated = true;
            return;
          }
          const below = children.get(p.id) ?? [];
          out.push({
            id: p.id,
            title: p.title,
            kind: p.kind,
            parentId: p.parentId && byId.has(p.parentId) ? p.parentId : null,
            ...(p.kind === "SHORTCUT" ? { opens: p.shortcut?.targetId ?? null } : {}),
            access: p.access,
            ...(p.lock ? { locked: true } : {}),
            ...(p.personal && p.parentId === null ? { personal: true } : {}),
            ...(level >= depth && below.length > 0 ? { more: below.length } : {}),
          });
          if (level < depth) walk(below, level + 1);
        }
      };
      walk(start, 1);
      return json({ pages: out, ...(truncated ? { truncated: true } : {}) });
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a page",
      description:
        "A page's title and content: a document as Markdown (child page views as links, attachments as links that need a login), a whiteboard as its items. Also its chats (for get_chat) and its child pages.",
      inputSchema: z.object({ pageId }),
      annotations: readOnly,
    },
    async ({ pageId: id }) => {
      const access = await getPageAccess(prisma, userId, id);
      if (!access) return fail(NOT_FOUND);
      const page = await prisma.page.findUniqueOrThrow({ where: { id }, select: { kind: true, shortcutTargetId: true } });
      if (page.kind === "SHORTCUT") {
        return json({ id, kind: page.kind, opens: await shortcutTarget(userId, page.shortcutTargetId) });
      }
      const detail = await pageDetail(userId, id, access.rootId);
      const tree = await getVisibleTree(prisma, userId, access.rootId);
      const children = (tree ? resolveShortcuts([tree])[0].pages : [])
        .filter((p) => p.parentId === id)
        .map((p) => ({ id: p.id, title: p.title, kind: p.kind }));
      const { markdown: body, ...meta } = detail;
      const head = { ...meta, url: await pageUrl(id), children };
      if (page.kind === "WHITEBOARD") {
        const doc = new Y.Doc();
        const state = await currentPageState(id);
        if (state) Y.applyUpdate(doc, state);
        return json({ ...head, items: readItems(doc) });
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ ...head, chats: await pageChats(id) }, null, 1) },
          { type: "text", text: body || "(empty)" },
        ],
      };
    },
  );

  server.registerTool(
    "get_chat",
    {
      title: "Read a chat",
      description:
        "The latest messages of a chat in a page (its id from get_page's `chats`), oldest first. Text is Markdown; mentions are <@userId> (<@all>: everyone), named in `mentions`.",
      inputSchema: z.object({ pageId, chatId: z.string().min(1).max(64) }),
      annotations: readOnly,
    },
    async ({ pageId: id, chatId }) => {
      if (!(await getPageAccess(prisma, userId, id))) return fail(NOT_FOUND);
      if (!(await pageChats(id)).some((c) => c.id === chatId)) return fail("The page has no chat with that id.");
      return json(await chatMessages(id, chatId, (await siteChatWords()).everyone));
    },
  );

  server.registerTool(
    "list_my_todos",
    {
      title: "My TODOs",
      description: "The TODOs assigned to you in pages you can open, the earliest due first.",
      inputSchema: z.object({ includeDone: z.boolean().optional().describe("Include finished ones (default false)") }),
      annotations: readOnly,
    },
    async ({ includeDone = false }) => {
      const rows = await prisma.pageTodoItem.findMany({
        where: { assigneeId: userId, ...(includeDone ? {} : { checked: false }) },
        select: { pageId: true, blockId: true },
        take: 1000,
      });
      const visible = new Map((await getVisibleTrees(prisma, userId)).flatMap((t) => t.pages.map((p) => [p.id, p] as const)));
      const origin = await getPublicUrl();
      const todos: { pageId: string; pageTitle: string; url: string; text: string; due: string | null; done: boolean }[] = [];
      for (const pid of new Set(rows.map((r) => r.pageId))) {
        const page = visible.get(pid);
        if (!page) continue;
        const state = await currentPageState(pid);
        if (!state) continue;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        const wanted = new Set(rows.filter((r) => r.pageId === pid).map((r) => r.blockId));
        for (const todo of docNotices(doc).todos) {
          if (!wanted.has(todo.blockId) || todo.assigneeId !== userId || (!includeDone && todo.checked)) continue;
          todos.push({ pageId: pid, pageTitle: page.title, url: `${origin}/pages/${pid}`, text: todo.text, due: todo.due, done: todo.checked });
        }
      }
      todos.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
      return json({ todos: todos.slice(0, MAX_TODOS), ...(todos.length > MAX_TODOS ? { truncated: true } : {}) });
    },
  );

  server.registerTool(
    "get_child_properties",
    {
      title: "Read child pages' properties",
      description:
        "A page's child pages (those you can see, in their order) with their values in the columns of the page's child page table (its properties): all columns, or only those named in `properties`. A select value is its option's name, a person { id, name }, a date \"YYYY-MM-DD\"; a masked value can't be read here ({ masked: true }). Columns sharing a name are \"name (2)\", ….",
      inputSchema: z.object({
        pageId,
        properties: z.array(z.string().min(1).max(100)).max(30).optional().describe("Column names to return (default: all)"),
      }),
      annotations: readOnly,
    },
    async ({ pageId: id, properties }) => {
      if (!(await getPageAccess(prisma, userId, id))) return fail(NOT_FOUND);
      const result = await childProperties(userId, id, properties && properties.length > 0 ? properties : undefined);
      if (!result) return fail(NOT_FOUND);
      if ("unknown" in result) return fail(`The page's child pages have no property named ${result.unknown.map((n) => JSON.stringify(n)).join(", ")}.`);
      return json(result);
    },
  );

  server.registerTool(
    "list_page_people",
    {
      title: "People on a page",
      description: "The people who can open a page and can be mentioned (<@userId>) or sent a notification about it (send_notification), as { id, name }.",
      inputSchema: z.object({ pageId }),
      annotations: readOnly,
    },
    async ({ pageId: id }) => {
      if (!(await getPageAccess(prisma, userId, id))) return fail(NOT_FOUND);
      return json({ people: await pagePeople(prisma, id) });
    },
  );

  if (caller.scope !== "WRITE") return;

  server.registerTool(
    "rename_page",
    {
      title: "Rename a page",
      description: "Changes a page's title (a document or a whiteboard). Everyone with the page open sees it; the page's history keeps the title before.",
      inputSchema: z.object({ pageId, title: z.string().max(MAX_TITLE_LENGTH) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ pageId: id, title }) => {
      const access = await getPageAccess(prisma, userId, id);
      if (!access) return fail(NOT_FOUND);
      if (!atLeast(access.access, "EDIT")) return fail("You can't edit this page.");
      if (!canEditPage(access)) return fail("The page is locked.");
      const page = await prisma.page.findUniqueOrThrow({ where: { id }, select: { kind: true } });
      if (page.kind === "SHORTCUT") return fail("The page is a shortcut, which has no title of its own.");
      await replacePageContent(id, userId, { title: normalizeTitle(title) });
      return json({ id, url: await pageUrl(id) });
    },
  );

  server.registerTool(
    "send_notification",
    {
      title: "Send a notification",
      description: `Sends people a notification about a page, from you, with a text of up to ${MAX_MESSAGE_LENGTH} characters (its http(s) URLs become links; plain text, not Markdown). They see it in their notifications (and on their devices, if they turned that on), and it opens the page. The people must be among list_page_people's. Needs edit access to the page.`,
      inputSchema: z.object({
        pageId,
        userIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_MESSAGE_RECIPIENTS),
        text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ pageId: id, userIds, text }) => {
      const result = await sendPageMessage(userId, id, userIds, text);
      if ("error" in result) {
        const e = result.error;
        switch (e.code) {
          case "not_found":
            return fail(NOT_FOUND);
          case "forbidden":
            return fail("You can't edit this page, so you can't send notifications about it.");
          case "invalid":
            return fail(e.message);
          case "unknown_recipients":
            return fail(`These users can't open the page, or can't be sent a notification about it (see list_page_people): ${e.userIds.join(", ")}`);
          case "too_many":
            return fail("Too many notifications at once. Wait a moment and try again.");
        }
      }
      return json({ recipients: result.recipients });
    },
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description: "Creates a page as the last child of `parentId` (you need edit access there). A document can start with Markdown content.",
      inputSchema: z.object({
        parentId: pageId.describe("The page to create it under"),
        title: z.string().max(MAX_TITLE_LENGTH),
        markdown: markdown.optional(),
        kind: z.enum(["DOCUMENT", "WHITEBOARD"]).optional().describe("Default DOCUMENT"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ parentId, title, markdown: md, kind = "DOCUMENT" }) => {
      if (kind === "WHITEBOARD" && md) return fail("A whiteboard has no Markdown content (draw on it with edit_whiteboard).");
      const created = await insertChildPage(userId, parentId, normalizeTitle(title), kind);
      if ("error" in created) {
        if (created.error === "lockedWithChildren") return fail("The parent page is locked with its child pages.");
        if (created.error === "tooDeep") return fail("The page would be nested too deep.");
        return fail("The parent page doesn't exist, or you can't edit it.");
      }
      if (md) {
        const body = await adoptFilesInBody(userId, created.id, await markdownToBody(md));
        await replacePageContent(created.id, userId, { body });
      }
      return json({ id: created.id, url: await pageUrl(created.id) });
    },
  );

  server.registerTool(
    "append_to_page",
    {
      title: "Add to a page",
      description: "Adds Markdown content at the end of a document. Everyone with the page open sees it; the page's history keeps what was there.",
      inputSchema: z.object({ pageId, markdown }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ pageId: id, markdown: md }) => {
      const page = await editableDocument(userId, id);
      if ("content" in page) return page;
      const body = await adoptFilesInBody(userId, id, await markdownToBody(md));
      await editPageBody(id, userId, { kind: "append", body });
      return json({ id, url: await pageUrl(id) });
    },
  );

  server.registerTool(
    "replace_section",
    {
      title: "Replace a section",
      description:
        "Replaces what's under one top-level heading of a document (up to the next heading of the same or a higher level), keeping the heading. Refused when the section holds blocks Markdown can't carry back unchanged (child page views, chats, masked text, TODOs, files, columns…) or locked blocks. The page's history keeps what was there. Use headings deeper than the section's own inside the new content.",
      inputSchema: z.object({
        pageId,
        heading: z.string().min(1).max(500).describe("The heading's text"),
        level: z.number().int().min(2).max(6).optional().describe("The heading's level, when several headings share the text"),
        occurrence: z.number().int().min(1).optional().describe("1-based, among the matching headings, when there are still several"),
        markdown: markdown.describe("The section's new content (empty: remove it, keeping the heading)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ pageId: id, heading, level, occurrence, markdown: md }) => {
      const page = await editableDocument(userId, id);
      if ("content" in page) return page;
      const body = await adoptFilesInBody(userId, id, await markdownToBody(md));
      const problem = await editPageBody(id, userId, { kind: "section", target: { heading, level, occurrence }, body });
      if (problem) return fail(sectionProblem(problem));
      return json({ id, url: await pageUrl(id) });
    },
  );

  server.registerTool(
    "post_chat",
    {
      title: "Post to a chat",
      description:
        "Posts a message to a chat in a page, as you. Markdown; mention someone with <@userId> (<@all>: everyone who can open the page). Those mentioned and those in the chat are notified.",
      inputSchema: z.object({
        pageId,
        chatId: z.string().min(1).max(64),
        text: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
        replyToId: z.string().max(64).optional().describe("The message replied to"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ pageId: id, chatId, text, replyToId }) => {
      const access = await getPageAccess(prisma, userId, id);
      if (!access || !(await pageChats(id)).some((c) => c.id === chatId)) return fail("The page doesn't exist, you can't see it, or it has no chat with that id.");
      if (!atLeast(access.access, "EDIT")) return fail("You can't edit this page.");
      if (!canEditPage(access)) return fail("The page is locked.");
      const words = await siteChatWords();
      const result = await postChat(userId, id, chatId, text, replyToId ?? null, null, words);
      if ("error" in result) {
        const e = result.error;
        switch (e.code) {
          case "locked":
            return fail("The chat is locked.");
          case "invalid":
            return fail(`The text must be 1 to ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
          case "reply_gone":
            return fail("The message replied to isn't in this chat.");
          case "too_many":
            return fail("Too many messages at once. Wait a moment and try again.");
          case "everyone_too_soon":
            return fail(`<@all> can be used once every ${e.minutes} minutes in a chat.`);
          case "not_allowed":
            return fail("You can't post here.");
        }
      }
      return json({ id: result.id });
    },
  );

  const item = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
  server.registerTool(
    "edit_whiteboard",
    {
      title: "Edit a whiteboard",
      description: [
        "Adds, changes and removes a whiteboard's items at once (get_page shows them). Items:",
        "- boxes: { type: sticky | rect | ellipse | diamond | text, x, y, w, h, text, color }; color: yellow, orange, pink, purple, blue, green, gray, white, transparent",
        "- connectors between boxes: { type: connector, from, to, text, arrows: end | both | start | none, route: straight | elbow, stroke: solid | bold | dashed | double }",
        "- lines: { type: line, x1, y1, x2, y2, arrows, stroke }",
        "Texts may have styles on parts of them (textMarks, startTextMarks, endTextMarks: ranges of the text that are bold, italic, underlined, struck through or colored); they're shown by get_page but can't be written here, and writing a text takes its styles away.",
        "Added items may bring their own id, so connectors in the same call can join them. Removing a box removes its connectors. `update` items are { id, ...fields to change }.",
      ].join("\n"),
      inputSchema: z.object({
        pageId,
        add: z.array(item).optional(),
        update: z.array(item).optional(),
        remove: z.array(z.string()).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ pageId: id, add, update, remove }) => {
      const access = await getPageAccess(prisma, userId, id);
      if (!access) return fail(NOT_FOUND);
      const page = await prisma.page.findUniqueOrThrow({ where: { id }, select: { kind: true } });
      if (page.kind !== "WHITEBOARD") return fail("The page isn't a whiteboard.");
      if (!atLeast(access.access, "EDIT")) return fail("You can't edit this page.");
      if (!canEditPage(access)) return fail("The page is locked.");
      const doc = new Y.Doc();
      const state = await currentPageState(id);
      if (state) Y.applyUpdate(doc, state);
      const plan = planWhiteboardChange(doc, { add, update, remove }, randomUUID);
      if ("error" in plan) return fail(plan.error);
      // Images: attachments of this page only, as in the API.
      const fileIds = [...new Set(imageFileIds(plan.ops))];
      if (fileIds.length > 0 && (await prisma.fileObject.count({ where: { id: { in: fileIds }, pageId: id } })) !== fileIds.length) {
        return fail("An image's \"src\" must be an attachment of this page.");
      }
      await changeWhiteboard(id, userId, plan.ops);
      return json({ added: plan.added });
    },
  );
}

