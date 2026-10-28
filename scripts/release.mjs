// Makes a release: pnpm release <version>   (e.g. pnpm release 0.2.0)
//
// - Sets the version in the root package.json (the one that counts:
//   apps/web/src/lib/build-info.ts) and, to keep them the same, in
//   apps/web and packages/shared.
// - Turns CHANGELOG.md's "Unreleased" section into this version's, dated
//   today, with a new empty "Unreleased" above it.
// - Commits, and tags v<version> (annotated). Nothing is pushed: check the
//   commit, then `git push && git push origin v<version>`.
//
// Versions are SemVer (MAJOR.MINOR.PATCH), and must go up. Needs a clean
// working tree, so the release commit holds only the release.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = ["package.json", "apps/web/package.json", "packages/shared/package.json"];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !SEMVER.test(version)) fail("usage: pnpm release <MAJOR.MINOR.PATCH>  (e.g. 0.2.0)");

// Compares two versions (a pre-release comes before its release).
function compare(a, b) {
  const [, ...pa] = SEMVER.exec(a);
  const [, ...pb] = SEMVER.exec(b);
  for (let i = 0; i < 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  if (pa[3] === pb[3]) return 0;
  if (!pa[3]) return 1;
  if (!pb[3]) return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

const current = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
if (SEMVER.test(current) && compare(version, current) <= 0) fail(`${version} isn't above the current version ${current}`);
if (git("status", "--porcelain")) fail("the working tree has changes: commit or stash them first");
const tag = `v${version}`;
if (git("tag", "--list", tag)) fail(`the tag ${tag} already exists`);

// Only the "version" line changes, so the files keep their formatting.
for (const file of MANIFESTS) {
  const full = path.join(root, file);
  const text = readFileSync(full, "utf8");
  const next = text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
  if (next === text && !text.includes(`"version": "${version}"`)) fail(`no "version" in ${file}`);
  writeFileSync(full, next);
}

const changelogFile = path.join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogFile, "utf8");
if (!changelog.includes("## [Unreleased]")) fail('CHANGELOG.md has no "## [Unreleased]" section');
const today = new Date().toISOString().slice(0, 10);
writeFileSync(changelogFile, changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${today}`));

git("add", ...MANIFESTS, "CHANGELOG.md");
git("commit", "-m", `${tag} をリリースする`);
git("tag", "-a", tag, "-m", tag);
console.log(`Released ${tag} (${git("rev-parse", "--short", "HEAD")}). Not pushed: git push && git push origin ${tag}`);
