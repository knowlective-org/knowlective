import { handleMcp } from "@/lib/mcp/server";

// The MCP server (lib/mcp/). Streamable HTTP without sessions: POST carries
// every message; GET and DELETE (session streams) are answered 405 by the SDK.
// Each request is authenticated (lib/mcp/auth.ts) before the SDK sees it.

export async function POST(request: Request) {
  return handleMcp(request);
}

export async function GET(request: Request) {
  return handleMcp(request);
}

export async function DELETE(request: Request) {
  return handleMcp(request);
}
