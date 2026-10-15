import pg from "pg";
import type { PrismaClient } from "shared";
import { DIMENSIONS, MODEL, MODEL_DTYPE, loadEmbedder, type Embedder } from "./semantic-model";
import { pageSearchText } from "../src/lib/search-index";
import { registerSemanticSearch, type SemanticHit, type SemanticStatus } from "../src/lib/semantic-bridge";

// Semantic search (意味での検索): each page's text is cut into passages, and
// each passage becomes a vector (embedding) of what it means. A query becomes
// a vector the same way, and the passages nearest to it are the results.
//
// - The model (server/semantic-model.ts) runs here on the CPU. Nothing is
//   sent outside: the model is downloaded once, or built into the Docker image.
// - The vectors are in a PostgreSQL + pgvector instance of their own
//   (VECTOR_DATABASE_URL), apart from the content database. They can't be
//   encrypted by the app — the database computes distances on them — and
//   say roughly what a page is about, so that instance is encrypted on disk
//   (pg_tde) and holds nothing else: page ids, passage offsets, vectors. No
//   text. It can be rebuilt from the content database at any time.
// - Pages are (re)embedded in the background: a page whose search index
//   (PageSearchIndex.indexedAt, updated on every save) is newer than its
//   vectors, once edits have settled for a moment.

// Changing the model or the passages makes every stored vector stale.
const INDEX_VERSION = `${MODEL}:${MODEL_DTYPE}:chunks-v2`;

// Passage size (characters of body text), the overlap of passages cut out of
// one long line, and an upper bound per page.
const CHUNK_CHARS = 300;
const CHUNK_OVERLAP = 50;
const MAX_CHUNKS = 200;
const EMBED_BATCH = 16;

// Background indexing: how often to look, how long a page must have been
// left alone, how many pages per round.
const TICK_MS = 10_000;
const SETTLE_MS = 5_000;
const PAGES_PER_TICK = 20;
// Now and then, a full pass (pages that are gone, missed changes).
const FULL_PASS_MS = 60 * 60 * 1000;

type Chunk = { start: number; end: number; text: string };

// The page's text as passages, each prefixed with the title (it tells the
// model what the passage is about). Attachment names go with the title in a
// passage of their own (start/end -1). A title alone makes no passage: too
// little to go on, it came out close to all sorts of queries (titles are
// found by keyword search).
export function chunkPage(text: { title: string; body: string; files: string[] }): Chunk[] {
  const chunks: Chunk[] = [];
  const head = text.title.trim();
  const push = (start: number, end: number) => {
    const slice = text.body.slice(start, end).trim();
    if (slice) chunks.push({ start, end, text: head ? `${head}\n${slice}` : slice });
  };
  let start = -1;
  let end = -1;
  let offset = 0;
  for (const line of text.body.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    if (!line.trim()) continue;
    if (line.length > CHUNK_CHARS) {
      // A long paragraph: windows that overlap a little.
      if (start >= 0) push(start, end);
      start = -1;
      for (let s = lineStart; s < lineEnd; s += CHUNK_CHARS - CHUNK_OVERLAP) {
        push(s, Math.min(s + CHUNK_CHARS, lineEnd));
        if (s + CHUNK_CHARS >= lineEnd) break;
      }
      continue;
    }
    if (start >= 0 && lineEnd - start > CHUNK_CHARS) {
      push(start, end);
      start = -1;
    }
    if (start < 0) start = lineStart;
    end = lineEnd;
  }
  if (start >= 0) push(start, end);
  if (text.files.length > 0) chunks.unshift({ start: -1, end: -1, text: [head, ...text.files].filter(Boolean).join("\n") });
  return chunks.slice(0, MAX_CHUNKS);
}

// e5 models are trained with these prefixes.
const asPassage = (text: string) => `passage: ${text}`;
const asQuery = (text: string) => `query: ${text}`;

// ---- The vector database ----------------------------------------------------

const toVector = (values: number[]) => `[${values.join(",")}]`;

class VectorStore {
  constructor(private pool: pg.Pool) {}

  async init(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.pool.query(`CREATE TABLE IF NOT EXISTS index_meta (key text PRIMARY KEY, value text NOT NULL)`);
    const { rows } = await this.pool.query<{ value: string }>(`SELECT value FROM index_meta WHERE key = 'version'`);
    if (rows[0]?.value !== INDEX_VERSION) {
      // Another model or way of cutting passages: start over.
      await this.pool.query("DROP TABLE IF EXISTS passage_vectors, page_vectors");
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS page_vectors (
        page_id text PRIMARY KEY,
        -- PageSearchIndex.indexedAt of the text the vectors were made from.
        indexed_at timestamptz NOT NULL
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS passage_vectors (
        page_id text NOT NULL REFERENCES page_vectors ON DELETE CASCADE,
        n int NOT NULL,
        start_offset int NOT NULL,
        end_offset int NOT NULL,
        embedding vector(${DIMENSIONS}) NOT NULL,
        PRIMARY KEY (page_id, n)
      )`);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS passage_vectors_embedding ON passage_vectors USING hnsw (embedding vector_cosine_ops)",
    );
    await this.pool.query(
      `INSERT INTO index_meta (key, value) VALUES ('version', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [INDEX_VERSION],
    );
  }

  async indexedPages(since?: Date): Promise<Map<string, number>> {
    const { rows } = since
      ? await this.pool.query<{ page_id: string; indexed_at: Date }>(
          "SELECT page_id, indexed_at FROM page_vectors WHERE indexed_at > $1",
          [since],
        )
      : await this.pool.query<{ page_id: string; indexed_at: Date }>("SELECT page_id, indexed_at FROM page_vectors");
    return new Map(rows.map((r) => [r.page_id, r.indexed_at.getTime()]));
  }

  async replacePage(pageId: string, indexedAt: Date, passages: { start: number; end: number; embedding: number[] }[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM page_vectors WHERE page_id = $1", [pageId]);
      await client.query("INSERT INTO page_vectors (page_id, indexed_at) VALUES ($1, $2)", [pageId, indexedAt]);
      for (const [n, p] of passages.entries()) {
        await client.query(
          "INSERT INTO passage_vectors (page_id, n, start_offset, end_offset, embedding) VALUES ($1, $2, $3, $4, $5::vector)",
          [pageId, n, p.start, p.end, toVector(p.embedding)],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async removePages(pageIds: string[]): Promise<void> {
    if (pageIds.length > 0) await this.pool.query("DELETE FROM page_vectors WHERE page_id = ANY($1::text[])", [pageIds]);
  }

  // Nearest passages among `pageIds`. The HNSW index is filtered by page, so
  // it keeps scanning until it has found enough (iterative scan).
  async search(embedding: number[], pageIds: string[], limit: number): Promise<SemanticHit[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
      await client.query("SET LOCAL hnsw.ef_search = 200");
      const { rows } = await client.query<{ page_id: string; start_offset: number; end_offset: number; distance: number }>(
        `SELECT page_id, start_offset, end_offset, embedding <=> $1::vector AS distance
         FROM passage_vectors WHERE page_id = ANY($2::text[])
         ORDER BY distance LIMIT $3`,
        [toVector(embedding), pageIds, limit],
      );
      await client.query("COMMIT");
      return rows.map((r) => ({ pageId: r.page_id, start: r.start_offset, end: r.end_offset, score: 1 - r.distance }));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---- Indexing and the bridge ------------------------------------------------

// Starts semantic search if VECTOR_DATABASE_URL is set: loads the model and
// prepares the vector database in the background (search by words works
// meanwhile), then keeps the vectors up to date. Never throws.
export function startSemanticSearch(prisma: PrismaClient): { stop(): Promise<void> } {
  const url = process.env.VECTOR_DATABASE_URL;
  if (!url) {
    registerSemanticSearch({ status: () => "off", search: async () => [] });
    return { stop: async () => {} };
  }
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const store = new VectorStore(pool);
  let status: SemanticStatus = "loading";
  let embed: Embedder | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  // Latest PageSearchIndex.indexedAt seen, and when the last full pass ran.
  let cursor: Date | null = null;
  let lastFullPass = 0;

  registerSemanticSearch({
    status: () => status,
    async search(query, pageIds, limit) {
      if (!embed || pageIds.length === 0) return [];
      const [vector] = await embed([asQuery(query)]);
      return store.search(vector, pageIds, limit);
    },
  });

  const indexPage = async (pageId: string, indexedAt: Date) => {
    const text = await pageSearchText(prisma, pageId);
    if (!text) return;
    const chunks = chunkPage(text);
    const passages: { start: number; end: number; embedding: number[] }[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embed!(batch.map((c) => asPassage(c.text)));
      batch.forEach((c, j) => passages.push({ start: c.start, end: c.end, embedding: vectors[j] }));
    }
    await store.replacePage(pageId, indexedAt, passages);
  };

  // One round: pages changed since the cursor (all of them on a full pass)
  // whose vectors are older. Returns whether work is left over.
  const tick = async (): Promise<boolean> => {
    const full = cursor === null || Date.now() - lastFullPass >= FULL_PASS_MS;
    // A little before the cursor: a save can commit with an earlier time.
    const since = full ? undefined : new Date(cursor!.getTime() - 60_000);
    const [pages, indexed] = await Promise.all([
      prisma.pageSearchIndex.findMany({
        where: since ? { indexedAt: { gt: since } } : undefined,
        select: { pageId: true, indexedAt: true },
      }),
      store.indexedPages(since),
    ]);
    if (full) {
      const live = new Set(pages.map((p) => p.pageId));
      await store.removePages([...indexed.keys()].filter((id) => !live.has(id)));
      lastFullPass = Date.now();
    }
    const now = Date.now();
    const stale = pages
      .filter((p) => (indexed.get(p.pageId) ?? -1) < p.indexedAt.getTime() && now - p.indexedAt.getTime() >= SETTLE_MS)
      .sort((a, b) => b.indexedAt.getTime() - a.indexedAt.getTime());
    for (const p of stale.slice(0, PAGES_PER_TICK)) {
      if (stopped) return false;
      try {
        await indexPage(p.pageId, p.indexedAt);
      } catch (err) {
        console.error("[semantic] indexing a page failed", err);
      }
    }
    const leftover = stale.length > PAGES_PER_TICK;
    // The cursor moves on only once nothing before it is left: until then
    // the next round looks at the same pages (on the first pass, all).
    // Pages still settling are within the margin, picked up later.
    if (!leftover) for (const p of pages) if (!cursor || p.indexedAt > cursor) cursor = p.indexedAt;
    return leftover;
  };

  const loop = async () => {
    let more = false;
    try {
      more = await tick();
    } catch (err) {
      console.error("[semantic] indexing round failed", err);
    }
    if (!stopped) timer = setTimeout(() => void loop(), more ? 0 : TICK_MS);
  };

  void (async () => {
    try {
      await store.init();
      const started = Date.now();
      embed = await loadEmbedder();
      console.log(`[semantic] model ready (${Math.round((Date.now() - started) / 1000)}s)`);
      status = "ready";
      void loop();
    } catch (err) {
      status = "off";
      console.error("[semantic] semantic search is off: starting it failed", err);
    }
  })();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await pool.end().catch(() => {});
    },
  };
}
