// Writes apps/web/build-info.json while the Docker image is built (lib/build-info.ts):
// the image has no .git, so the commit is read here, from the .git/HEAD and
// refs that .dockerignore lets in. KNOWLECTIVE_COMMIT (a build argument)
// overrides it, e.g. for builds from a source archive.
//   cd apps/web && node --import tsx server/write-build-info.ts
import { writeFileSync } from "node:fs";
import { BUILD_INFO_FILE, readGitCommit, readVersion } from "../src/lib/build-info";

const override = process.env.KNOWLECTIVE_COMMIT?.trim().toLowerCase();
const commit = override && /^[0-9a-f]{40}$/.test(override) ? override : readGitCommit();
const info = { version: readVersion(), commit, builtAt: new Date().toISOString() };
writeFileSync(BUILD_INFO_FILE, `${JSON.stringify(info, null, 2)}\n`);
console.log(`[build-info] ${info.version} ${commit ?? "(commit unknown)"} ${info.builtAt}`);
