import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

// What this KNOWLECTIVE runs on, for the admin console's "About" page: the
// packages it depends on (as installed, with their licenses), the runtime and
// the database. Site admins only (it tells which versions are running).

export type PackageInfo = {
  name: string;
  // The installed version; null if it can't be found.
  version: string | null;
  // As declared in package.json.
  wanted: string;
  license: string | null;
  // Which parts of KNOWLECTIVE depend on it.
  usedBy: ("web" | "shared")[];
};

export type SystemInfo = {
  packages: PackageInfo[];
  node: string;
  postgres: string | null;
  migrations: { latest: string | null; latestAt: Date | null; count: number };
};

// apps/web is the app's working directory; packages/shared sits beside it.
const PARTS = {
  web: () => process.cwd(),
  shared: () => path.resolve(process.cwd(), "../../packages/shared"),
} as const;

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const licenseOf = (pkg: Record<string, unknown>): string | null => {
  const license = pkg.license;
  if (typeof license === "string") return license;
  if (license && typeof license === "object" && typeof (license as { type?: unknown }).type === "string") {
    return (license as { type: string }).type;
  }
  return null;
};

async function listPackages(): Promise<PackageInfo[]> {
  const byName = new Map<string, PackageInfo>();
  for (const part of ["web", "shared"] as const) {
    const dir = PARTS[part]();
    const manifest = await readJson(path.join(dir, "package.json"));
    const deps = (manifest?.dependencies ?? {}) as Record<string, string>;
    for (const [name, wanted] of Object.entries(deps)) {
      if (wanted.startsWith("workspace:")) continue;
      const existing = byName.get(name);
      if (existing) {
        existing.usedBy.push(part);
        continue;
      }
      // pnpm links each direct dependency into the part's own node_modules.
      const installed = await readJson(path.join(dir, "node_modules", name, "package.json"));
      byName.set(name, {
        name,
        version: typeof installed?.version === "string" ? installed.version : null,
        wanted,
        license: installed ? licenseOf(installed) : null,
        usedBy: [part],
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function postgresVersion(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    return rows[0]?.server_version ?? null;
  } catch {
    return null;
  }
}

async function migrationState(): Promise<SystemInfo["migrations"]> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date; count: bigint }[]>`
      SELECT migration_name, finished_at, COUNT(*) OVER () AS count
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC, migration_name DESC
      LIMIT 1`;
    const row = rows[0];
    return row
      ? { latest: row.migration_name, latestAt: row.finished_at, count: Number(row.count) }
      : { latest: null, latestAt: null, count: 0 };
  } catch {
    return { latest: null, latestAt: null, count: 0 };
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const [packages, postgres, migrations] = await Promise.all([listPackages(), postgresVersion(), migrationState()]);
  return { packages, node: process.version, postgres, migrations };
}
