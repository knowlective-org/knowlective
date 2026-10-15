import path from "node:path";

// The embedding model of semantic search (server/semantic-search.ts):
// multilingual-e5-small (MIT, 384 dimensions, ~130MB quantized), run on the
// CPU by transformers.js.
//
// It is kept in YOSUGA_MODEL_DIR (default apps/web/.models). In development
// it is downloaded from Hugging Face on first use; the Docker image has it
// built in (server/download-model.ts) and sets YOSUGA_MODEL_OFFLINE=1, so a
// running server never fetches anything.

export const MODEL = "Xenova/multilingual-e5-small";
export const MODEL_DTYPE = "q8";
export const DIMENSIONS = 384;

export type Embedder = (texts: string[]) => Promise<number[][]>;

export async function loadEmbedder(): Promise<Embedder> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = process.env.YOSUGA_MODEL_DIR || path.resolve(__dirname, "../.models");
  env.allowRemoteModels = process.env.YOSUGA_MODEL_OFFLINE !== "1";
  const extract = await pipeline("feature-extraction", MODEL, {
    dtype: MODEL_DTYPE,
    // Leave CPU for everything else this process does.
    session_options: { intraOpNumThreads: Number(process.env.YOSUGA_EMBED_THREADS) || 2 },
  });
  return async (texts) => (await extract(texts, { pooling: "mean", normalize: true })).tolist() as number[][];
}
