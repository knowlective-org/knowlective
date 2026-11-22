import { PUBLIC_CORS, metadataCacheHeaders, authorizationServerMetadata } from "@/lib/oauth/metadata";

// RFC 8414: this site as an OAuth authorization server, for MCP clients
// (lib/oauth/). With a base path, also answered at the root
// (/.well-known/oauth-authorization-server/<base path>, server/index.ts).

// auth: public — discovery metadata, the same for everyone
export async function GET() {
  return Response.json(await authorizationServerMetadata(), { headers: { ...PUBLIC_CORS, ...(await metadataCacheHeaders()) } });
}

// auth: public — CORS preflight
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}
