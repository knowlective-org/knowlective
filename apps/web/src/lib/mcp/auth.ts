import type { ApiKeyScope, SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api/keys";
import { createRateLimiter } from "@/lib/rate-limit";
import { ACCESS_TOKEN_PREFIX, authenticateAccessToken } from "@/lib/oauth/tokens";

// Who is calling the MCP server (/api/mcp). A call acts as one user, with
// their page permissions and never more, like the public API, by either:
// - an OAuth access token ("kna_…", lib/oauth/): the person connected the
//   app on the consent screen (claude.ai's connectors and the like);
// - a personal API key ("kn_…", lib/api/keys.ts), for clients configured by
//   hand (Claude Code, Cursor, VS Code…).
//
// The MCP server is part of the API: it needs the API on
// (InstanceConfig.apiEnabled) and the MCP server on (mcpEnabled), and the
// caller's role among apiKeyRoles.

export type McpCaller = {
  userId: string;
  siteRole: SiteRole;
  // READ: only the reading tools are offered.
  scope: ApiKeyScope;
  // What the caller authenticated with, for the rate limit.
  credentialId: string;
};

export async function mcpEnabled(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { apiEnabled: true, mcpEnabled: true } });
  return !!config?.apiEnabled && !!config.mcpEnabled;
}

// Per credential, in this process: a fixed window. Separate from the REST
// API's, since a client's tool calls come in bursts.
const rateLimited = createRateLimiter(60_000, 120);

export type McpAuthFailure = { status: 401 | 404 | 429; code: string; message: string; retryAfter?: number };

const INVALID: McpAuthFailure = {
  status: 401,
  code: "invalid_token",
  message: "The token is invalid, expired or revoked, or its owner can no longer use it.",
};

export async function authenticateMcp(request: Request): Promise<McpCaller | McpAuthFailure> {
  // Off: as if there were no MCP server here.
  if (!(await mcpEnabled())) return { status: 404, code: "mcp_disabled", message: "The MCP server is turned off on this site." };
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (!token) return { status: 401, code: "missing_token", message: "Connect with OAuth, or send an API key as \"Authorization: Bearer <key>\"." };

  let caller: McpCaller;
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const oauth = await authenticateAccessToken(token);
    if (!oauth) return INVALID;
    caller = { userId: oauth.userId, siteRole: oauth.siteRole, scope: oauth.scope, credentialId: `grant:${oauth.grantId}` };
  } else {
    const key = await authenticateApiKey(authorization);
    if ("error" in key) return INVALID;
    caller = { userId: key.user.id, siteRole: key.user.siteRole, scope: key.key.scope, credentialId: `key:${key.key.id}` };
  }
  const retryAfter = rateLimited(caller.credentialId);
  if (retryAfter !== null) return { status: 429, code: "rate_limited", message: "Too many requests. Wait a moment and try again.", retryAfter };
  return caller;
}
