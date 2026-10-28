import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Which KNOWLECTIVE this is: the version (the repository root's package.json,
// the one place it's set), the commit it was built from, and when it was
// built. A Docker image carries them in apps/web/build-info.json, written
// while building (server/write-build-info.ts: the image has no .git). In
// development they're read from the working copy every time (no build time).

export type BuildInfo = {
  version: string;
  // Full commit hash, or null when unknown.
  commit: string | null;
  // ISO time the image was built; null in development.
  builtAt: string | null;
};

export const BUILD_INFO_FILE = "build-info.json";

// apps/web is the working directory of the app (and of the image build step).
const appDir = () => process.cwd();
const repoRoot = () => path.resolve(appDir(), "../..");

const COMMIT = /^[0-9a-f]{40}$/;

// HEAD's commit from the .git directory itself (no git command needed):
// a detached HEAD, a loose ref, or a packed ref.
export function readGitCommit(root: string = repoRoot()): string | null {
  try {
    const gitDir = path.join(root, ".git");
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (COMMIT.test(head)) return head;
    const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
    if (!ref || ref.includes("..")) return null;
    const loose = path.join(gitDir, ref);
    if (existsSync(loose)) {
      const commit = readFileSync(loose, "utf8").trim();
      return COMMIT.test(commit) ? commit : null;
    }
    const packed = readFileSync(path.join(gitDir, "packed-refs"), "utf8");
    for (const line of packed.split("\n")) {
      const [commit, name] = line.trim().split(" ");
      if (name === ref && COMMIT.test(commit)) return commit;
    }
  } catch {
    // No .git (e.g. a source archive).
  }
  return null;
}

export function readVersion(root: string = repoRoot()): string {
  try {
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    if (typeof version === "string" && version) return version;
  } catch {
    // Fall through.
  }
  return "0.0.0";
}

let cached: BuildInfo | null = null;

export function getBuildInfo(): BuildInfo {
  if (cached) return cached;
  const file = path.join(appDir(), BUILD_INFO_FILE);
  if (existsSync(file)) {
    try {
      const info = JSON.parse(readFileSync(file, "utf8")) as Partial<BuildInfo>;
      cached = {
        version: typeof info.version === "string" ? info.version : readVersion(),
        commit: typeof info.commit === "string" && COMMIT.test(info.commit) ? info.commit : null,
        builtAt: typeof info.builtAt === "string" ? info.builtAt : null,
      };
      return cached;
    } catch {
      // Fall through to the working copy.
    }
  }
  // Development: not cached, so a new commit shows without a restart.
  return { version: readVersion(), commit: readGitCommit(), builtAt: null };
}

// "0.1.0+abc1234": the version with the commit as build metadata (SemVer).
export function versionLabel(info: BuildInfo): string {
  return info.commit ? `${info.version}+${info.commit.slice(0, 7)}` : info.version;
}
