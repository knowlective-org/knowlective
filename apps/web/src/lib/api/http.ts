import { type ApiKeyScope, type VisiblePage } from "shared";
import { getVisibleTree } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { MAX_TITLE_LENGTH, normalizeTitle } from "@/lib/page-title";
import { translatorFor } from "@/i18n/translator";
import { siteDefaultLocale } from "@/i18n/locale";
import { type ApiCaller, authenticateApiKey } from "./keys";
import { MAX_MARKDOWN_BYTES, pageContent } from "./page-content";

// The public API's request handling (/api/v1/*, Route Handlers): the key,
// the scope, errors as JSON, a rate limit per key.
//
// Errors: { "error": { "code": "...", "message": "..." } }; the message is
// English (for developers), the code is what to branch on.
// CSRF needs nothing more: the key comes in the Authorization header, which a
// page on another site can't send without a CORS preflight, and the API
// answers none (cookies are ignored here).

export type ApiErrorCode =
  | "api_disabled"
  | "missing_key"
  | "invalid_key"
  | "insufficient_scope"
  | "rate_limited"
  | "invalid_body"
  | "too_large"
  | "not_found"
  | "forbidden"
  | "page_locked"
  | "too_deep";

const STATUS: Record<ApiErrorCode, number> = {
  api_disabled: 403,
  missing_key: 401,
  invalid_key: 401,
  insufficient_scope: 403,
  rate_limited: 429,
  invalid_body: 400,
  too_large: 413,
  not_found: 404,
  forbidden: 403,
  page_locked: 423,
  too_deep: 400,
};

const MESSAGES: Record<ApiErrorCode, string> = {
  api_disabled: "The API is turned off on this site.",
  missing_key: "Send the API key as \"Authorization: Bearer <key>\".",
  invalid_key: "The API key is invalid, expired or revoked, or its owner can no longer use the API.",
  insufficient_scope: "This API key can only read.",
  rate_limited: "Too many requests with this API key. Wait a moment and try again.",
  invalid_body: "The request body isn't valid.",
  too_large: "The request body is too large.",
  not_found: "The page doesn't exist, or the key's owner can't see it.",
  forbidden: "The key's owner can't edit this page.",
  page_locked: "The page is locked.",
  too_deep: "The page would be nested too deep.",
};

const NO_STORE = { "Cache-Control": "no-store" };

export function apiError(code: ApiErrorCode, message = MESSAGES[code], headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message } }, { status: STATUS[code], headers: { ...NO_STORE, ...headers } });
}

export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// ---- Rate limit --------------------------------------------------------------
// Per key, in this process (one per instance): a fixed window.

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const windows = new Map<string, { start: number; count: number }>();

function rateLimited(keyId: string): number | null {
  const now = Date.now();
  const w = windows.get(keyId);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(keyId, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [id, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(id);
    }
    return null;
  }
  w.count += 1;
  return w.count > MAX_REQUESTS_PER_WINDOW ? Math.ceil((w.start + WINDOW_MS - now) / 1000) : null;
}

// Runs `handler` for an accepted key with at least `scope`, or answers why not.
export async function withApiKey(
  request: Request,
  scope: ApiKeyScope,
  handler: (caller: ApiCaller) => Promise<Response>,
): Promise<Response> {
  const caller = await authenticateApiKey(request.headers.get("authorization"));
  if ("error" in caller) return apiError(caller.error);
  const retryAfter = rateLimited(caller.key.id);
  if (retryAfter !== null) return apiError("rate_limited", undefined, { "Retry-After": String(retryAfter) });
  if (scope === "WRITE" && caller.key.scope !== "WRITE") return apiError("insufficient_scope");
  return handler(caller);
}

// ---- Request bodies ----------------------------------------------------------

export type PageInput = { title?: string; markdown?: string };

// The JSON body of a create / update: `title` and `markdown`, both optional
// strings, plus `extra` fields the caller reads itself.
export async function readPageInput(
  request: Request,
): Promise<{ input: PageInput; body: Record<string, unknown> } | { error: Response }> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    return { error: apiError("invalid_body", "Send the body as JSON (Content-Type: application/json).") };
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_MARKDOWN_BYTES + 64 * 1024) return { error: apiError("too_large") };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: apiError("invalid_body", "The body isn't valid JSON.") };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: apiError("invalid_body", "The body must be a JSON object.") };
  }
  const record = body as Record<string, unknown>;
  const input: PageInput = {};
  if (record.title !== undefined) {
    if (typeof record.title !== "string") return { error: apiError("invalid_body", "\"title\" must be a string.") };
    const title = normalizeTitle(record.title);
    if (record.title.trim().length > MAX_TITLE_LENGTH) {
      return { error: apiError("invalid_body", `"title" can be at most ${MAX_TITLE_LENGTH} characters.`) };
    }
    input.title = title;
  }
  if (record.markdown !== undefined) {
    if (typeof record.markdown !== "string") {
      return { error: apiError("invalid_body", "\"markdown\" must be a string.") };
    }
    if (Buffer.byteLength(record.markdown, "utf8") > MAX_MARKDOWN_BYTES) {
      return { error: apiError("too_large", `"markdown" can be at most ${MAX_MARKDOWN_BYTES / 1024 / 1024} MB.`) };
    }
    input.markdown = record.markdown;
  }
  return { input, body: record };
}

// ---- Responses ---------------------------------------------------------------

// A page as listed: only what the key's owner can see (a parent they can't
// see is null, as in the sidebar).
export function pageSummary(page: VisiblePage, visible: Set<string>, rootId: string) {
  return {
    id: page.id,
    title: page.title,
    parentId: page.parentId && visible.has(page.parentId) ? page.parentId : null,
    rootId,
    access: page.access,
    locked: page.lock !== null,
  };
}

// A page with its content, for the key's owner (who can see it).
export async function pageDetail(userId: string, pageId: string, rootId: string) {
  const [tree, page] = await Promise.all([
    getVisibleTree(prisma, userId, rootId),
    prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { title: true, createdAt: true, updatedAt: true } }),
  ]);
  const visible = new Set(tree?.pages.map((p) => p.id) ?? []);
  const self = tree?.pages.find((p) => p.id === pageId);
  // "Untitled" in links to child pages without a title: the site's language.
  const untitled = translatorFor(await siteDefaultLocale())("common.untitled");
  const content = await pageContent(userId, pageId, page.title, untitled);
  return {
    ...(self ? pageSummary(self, visible, rootId) : { id: pageId, parentId: null, rootId }),
    title: content.title,
    markdown: content.markdown,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}
