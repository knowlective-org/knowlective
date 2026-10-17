// Semantic search (意味での検索) runs in the custom server
// (server/semantic-search.ts): the embedding model and the vector database
// live there, loaded once. The Next.js bundle is a separate module graph in
// the same process, so it reaches them through globalThis, like
// lib/collab-events.ts. Keep dependency-free.

// A passage of a page close in meaning to the query. start/end: where it is
// in the page's body text (pageSearchText().body); -1 when it's the title
// and attachment names only.
export type SemanticHit = { pageId: string; start: number; end: number; score: number };

// off: not configured (no VECTOR_DATABASE_URL), or failed to start.
// loading: the model or the index isn't ready yet.
export type SemanticStatus = "off" | "loading" | "ready";

type SemanticBridge = {
  status(): SemanticStatus;
  search(query: string, pageIds: string[], limit: number): Promise<SemanticHit[]>;
};

const BRIDGE_KEY = Symbol.for("knowlective.semantic-search");

export function registerSemanticSearch(bridge: SemanticBridge) {
  (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = bridge;
}

function bridge(): SemanticBridge | undefined {
  return (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as SemanticBridge | undefined;
}

export function semanticSearchStatus(): SemanticStatus {
  return bridge()?.status() ?? "off";
}

// The passages closest to `query` among `pageIds` (the pages the user can
// open), best first. Null when semantic search isn't available.
export async function semanticSearch(query: string, pageIds: string[], limit: number): Promise<SemanticHit[] | null> {
  const b = bridge();
  if (!b || b.status() !== "ready") return null;
  return b.search(query, pageIds, limit);
}
