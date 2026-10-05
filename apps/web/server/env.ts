import path from "node:path";
import { loadEnvConfig } from "@next/env";

// Imported first by server/index.ts, so env vars are in place before any
// other module (Prisma, the data key, Next.js itself) reads them.

export const dev = !process.argv.includes("--prod");
export const appDir = path.resolve(__dirname, "..");

// `next start` / `next dev` normally set this; with a custom server we must.
// Set it here instead of in package.json so `start` also works on Windows.
(process.env as Record<string, string>).NODE_ENV = dev ? "development" : "production";

// Same loader and file precedence Next.js uses (.env.local, .env.<mode>, .env).
loadEnvConfig(appDir, dev);
