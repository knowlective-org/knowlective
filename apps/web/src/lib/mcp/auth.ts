import type { ApiKeyScope, SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api/keys";
import { createRateLimiter } from "@/lib/rate-limit";

// Who is calling the MCP server (/api/mcp). A call acts as one user, with
// their page permissions and never more, like the public API:
// - a personal API key ("kn_…", lib/api/keys.ts), sent as a Bearer token by
//   clients configured by hand (Claude Code, Cursor, VS Code…).
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

export type McpAuthFailure = { status: 401 | 403 | 404 | 429; code: string; message: string; retryAfter?: number };

export async function authenticateMcp(request: Request): Promise<McpCaller | McpAuthFailure> {
  // Off: as if there were no MCP server here.
  if (!(await mcpEnabled())) return { status: 404, code: "mcp_disabled", message: "The MCP server is turned off on this site." };
  const authorization = request.headers.get("authorization");
  const caller = await authenticateApiKey(authorization);
  if ("error" in caller) {
    if (caller.error === "missing_key") {
      return { status: 401, code: "missing_token", message: "Send an API key as \"Authorization: Bearer <key>\"." };
    }
    return { status: 401, code: "invalid_token", message: "The token is invalid, expired or revoked, or its owner can no longer use it." };
  }
  const retryAfter = rateLimited(caller.key.id);
  if (retryAfter !== null) return { status: 429, code: "rate_limited", message: "Too many requests. Wait a moment and try again.", retryAfter };
  return { userId: caller.user.id, siteRole: caller.user.siteRole, scope: caller.key.scope, credentialId: caller.key.id };
}
