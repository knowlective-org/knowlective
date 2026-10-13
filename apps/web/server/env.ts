import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { loadEnvConfig, updateInitialEnv } from "@next/env";

// Imported first by server/index.ts, so env vars are in place before any
// other module (Prisma, the data key, Next.js itself) reads them.

export const dev = !process.argv.includes("--prod");
export const appDir = path.resolve(__dirname, "..");

// `next start` / `next dev` normally set this; with a custom server we must.
// Set it here instead of in package.json so `start` also works on Windows.
(process.env as Record<string, string>).NODE_ENV = dev ? "development" : "production";

// Same loader and file precedence Next.js uses (.env.local, .env.<mode>, .env).
loadEnvConfig(appDir, dev);

// Then the monorepo root's .env (the one Prisma and the scripts in
// packages/shared read), so the values don't have to be copied into this
// directory. Files here win, and so do variables that are already set.
const rootEnvFile = path.resolve(appDir, "../../.env");
if (existsSync(rootEnvFile)) {
  const added: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnvFile, "utf8")))) {
    if (process.env[key] === undefined && value !== undefined) added[key] = value;
  }
  Object.assign(process.env, added);
  // Next.js resets process.env to this snapshot when it reloads the .env
  // files in this directory during development; keep the root values in it.
  updateInitialEnv(added);
}
