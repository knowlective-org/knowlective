import { loadEmbedder } from "./semantic-model";

// Downloads the embedding model into YOSUGA_MODEL_DIR and checks that it
// runs. Used when building the Docker image:
//   YOSUGA_MODEL_DIR=/app/models node --import tsx apps/web/server/download-model.ts

async function main() {
  const embed = await loadEmbedder();
  const [vector] = await embed(["passage: YOSUGA"]);
  console.log(`Embedding model ready (${vector.length} dimensions) in ${process.env.YOSUGA_MODEL_DIR ?? "apps/web/.models"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
