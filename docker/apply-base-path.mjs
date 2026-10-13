// Sets the sub-path the app is served under (YOSUGA_BASE_PATH) in the built
// app, when the container starts. Run by docker-entrypoint.sh.
//
// Next.js fixes the base path when it builds: the value ends up inside the
// browser's code and the build's manifests. The image is built once, for
// everyone, so it is built with a placeholder instead, and the build output is
// kept as a template (.next-template). Here the template is copied to .next
// with the placeholder replaced by the real value — "" included.
//
// This is not something Next.js offers; it relies on the base path appearing
// in the build output as plain text. `docker build` checks that every
// placeholder can be replaced (--check), and the end-to-end tests are run
// against a container with and without a base path. Re-check after upgrading
// Next.js.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER = "/__YOSUGA_BASE_PATH__";
const NAME = PLACEHOLDER.slice(1);

// Same rule as apps/web/src/lib/base-path.ts.
function normalize(raw) {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (value !== "" && !/^(\/[A-Za-z0-9._~-]+)+$/.test(value)) {
    throw new Error(`YOSUGA_BASE_PATH must look like "/yosuga" or "/tools/yosuga" (got "${raw}")`);
  }
  return value;
}

// Not text: never contain the placeholder, and must not be rewritten as text.
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|wasm|gz|br|zip|pdf|mp4|webm)$/i;

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile() && !BINARY.test(entry.name)) yield full;
  }
}

// The placeholder as it appears in the build output, in the order to replace:
// - inside regular expressions the slash is escaped ("\/…"), in JSON twice;
//   replacing the last backslash with it keeps both forms right;
// - percent-encoded, where a path is part of a query string;
// - as it is.
export function replaceIn(text, basePath) {
  return text
    .replaceAll(`\\${PLACEHOLDER}`, basePath.replaceAll("/", "\\/"))
    .replaceAll(`%2F${NAME}`, encodeURIComponent(basePath))
    .replaceAll(PLACEHOLDER, basePath);
}

// Copies `template` to `target` with the base path set. Returns the files in
// which the placeholder's name is still found afterwards (there should be
// none: it would mean a form of it this script doesn't know).
export function apply(template, target, basePath) {
  mkdirSync(target, { recursive: true });
  // The directory itself is kept: it belongs to the user the app runs as.
  for (const entry of readdirSync(target)) rmSync(path.join(target, entry), { recursive: true, force: true });
  cpSync(template, target, { recursive: true });
  const left = [];
  for (const file of files(target)) {
    const before = readFileSync(file, "utf8");
    if (!before.includes(NAME)) continue;
    const after = replaceIn(before, basePath);
    writeFileSync(file, after);
    if (after.includes(NAME)) left.push(path.relative(target, file));
  }
  return left;
}

function main() {
  const [template, target, flag] = process.argv.slice(2);
  if (!template || !target) {
    console.error("usage: apply-base-path.mjs <template dir> <target dir> [--check]");
    process.exit(2);
  }
  if (!existsSync(template) || !statSync(template).isDirectory()) {
    console.error(`apply-base-path: ${template} not found`);
    process.exit(1);
  }

  // At build time: every placeholder must be replaceable, for a sub-path and
  // for none.
  if (flag === "--check") {
    for (const basePath of ["", "/a/b"]) {
      const left = apply(template, target, basePath);
      if (left.length > 0) {
        console.error(`apply-base-path: the placeholder is left in ${left.length} file(s) for "${basePath}":`);
        for (const file of left.slice(0, 20)) console.error(`  ${file}`);
        process.exit(1);
      }
    }
    rmSync(target, { recursive: true, force: true });
    console.log("apply-base-path: check passed");
    return;
  }

  const basePath = normalize(process.env.YOSUGA_BASE_PATH);
  const marker = path.join(target, ".yosuga-base-path");
  const wanted = JSON.stringify({ basePath });
  // Already done for this value (the container was restarted, not recreated).
  if (existsSync(marker) && readFileSync(marker, "utf8") === wanted) return;
  const left = apply(template, target, basePath);
  if (left.length > 0) {
    console.error(`apply-base-path: warning: the placeholder is left in ${left.length} file(s), e.g. ${left[0]}`);
  }
  writeFileSync(marker, wanted);
  console.log(`> base path: ${basePath === "" ? "(none)" : basePath}`);
}

// Run as a script (not imported).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
