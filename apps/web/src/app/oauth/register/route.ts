import { mcpEnabled } from "@/lib/mcp/auth";
import { limitPerAddress, oauthError, oauthJson, preflight, readParams } from "@/lib/oauth/http";
import { registerClient } from "@/lib/oauth/clients";

// Dynamic client registration (RFC 7591, lib/oauth/clients.ts): an app
// describes itself and gets an id. Open to anyone, as the standard has it:
// registering grants nothing (people still sign in and agree), and unused
// registrations are removed. Limited per network address.

const limited = limitPerAddress(60 * 60_000, 20);

// auth: public — registration gives no access by itself (lib/oauth/clients.ts)
export async function POST(request: Request) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  if (!(await mcpEnabled())) return oauthError("invalid_request", "The MCP server is turned off on this site.", 404);
  const body = /^application\/json\b/i.test(request.headers.get("content-type") ?? "") ? await readParams(request) : null;
  if (!body) return oauthError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  const client = await registerClient(body);
  if ("error" in client) return oauthError(client.code, client.error);
  return oauthJson(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

// auth: public — CORS preflight
export async function OPTIONS() {
  return preflight();
}
