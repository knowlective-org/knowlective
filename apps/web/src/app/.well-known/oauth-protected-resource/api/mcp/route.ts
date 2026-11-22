import { PUBLIC_CORS, metadataCacheHeaders, protectedResourceMetadata } from "@/lib/oauth/metadata";

// RFC 9728: the MCP server (/api/mcp) as a protected resource, naming this
// site as its authorization server. Its 401 points here (lib/mcp/server.ts).

// auth: public — discovery metadata, the same for everyone
export async function GET() {
  return Response.json(await protectedResourceMetadata(), { headers: { ...PUBLIC_CORS, ...(await metadataCacheHeaders()) } });
}

// auth: public — CORS preflight
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}
