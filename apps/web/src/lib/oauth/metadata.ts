import { getPublicUrl } from "@/lib/site-url";
import { OAUTH_SCOPES } from "./params";

// Where an MCP client discovers how to connect (lib/oauth/):
// - the MCP server's 401 names its Protected Resource Metadata (RFC 9728),
// - which names this site as its authorization server,
// - whose metadata (RFC 8414) lists the endpoints.
// Everything is built from the public URL (origin and base path), never from
// the request's Host: the issuer must stay the same however it's reached.
//
// With a base path ("https://example.com/kn"), the standard places of the
// documents are outside it ("/.well-known/oauth-authorization-server/kn"):
// the custom server answers those too (server/index.ts), and the reverse
// proxy has to pass them on.

export async function oauthIssuer(): Promise<string> {
  return getPublicUrl();
}

// The MCP server's URL: what tokens are for (the `resource`, RFC 8707).
export async function mcpResourceUrl(): Promise<string> {
  return `${await getPublicUrl()}/api/mcp`;
}

export async function protectedResourceMetadataUrl(): Promise<string> {
  return `${await getPublicUrl()}/.well-known/oauth-protected-resource/api/mcp`;
}

export async function protectedResourceMetadata() {
  return {
    resource: await mcpResourceUrl(),
    authorization_servers: [await oauthIssuer()],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "KNOWLECTIVE",
  };
}

export async function authorizationServerMetadata() {
  const issuer = await oauthIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

// The metadata documents are read by apps from anywhere, browsers included;
// they hold nothing personal.
export const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
