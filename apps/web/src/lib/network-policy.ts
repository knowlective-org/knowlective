import type { PrismaClient } from "shared";
import { isIpAllowed } from "./ip";

// What a request may do, by the network it comes from (InstanceConfig.
// networkFullAccess and networkOther*, set under "Security" in the admin
// console). Shared by the custom server (refusing access at all, collab) and
// the app (lib/page-access.ts, file routes) — relative imports only.
//
// No full-access networks set: no restriction. Otherwise an address in the
// list has full access, and any other gets what the "other networks"
// settings allow. These cap what page permissions allow; they never add
// anything. The admin console isn't covered (it has adminIpAllowlist).

export type NetworkSettings = {
  fullAccess: string[];
  access: boolean;
  read: boolean;
  write: boolean;
  download: boolean;
  upload: boolean;
};

export type NetworkCaps = {
  // In a full-access network (or no restriction set).
  full: boolean;
  access: boolean;
  read: boolean;
  write: boolean;
  download: boolean;
  upload: boolean;
};

export const FULL_CAPS: NetworkCaps = { full: true, access: true, read: true, write: true, download: true, upload: true };

export function capsFor(ip: string, settings: NetworkSettings): NetworkCaps {
  if (settings.fullAccess.length === 0 || isIpAllowed(ip, settings.fullAccess)) return FULL_CAPS;
  const access = settings.access;
  const read = access && settings.read;
  return {
    full: false,
    access,
    read,
    // Changing needs reading.
    write: read && settings.write,
    download: access && settings.download,
    upload: read && settings.upload,
  };
}

// ---- The settings, cached ----------------------------------------------------
// Read on every request (the custom server checks each one), so kept for a
// few seconds. The cache lives on globalThis: the custom server and the
// Next.js bundle are separate module graphs, and saving in the admin console
// (networkSettingsChanged()) must reach both.

const CACHE_MS = 10_000;
const CACHE_KEY = Symbol.for("knowlective.network-settings");
type Cache = { at: number; settings: NetworkSettings };

export async function getNetworkSettings(prisma: PrismaClient): Promise<NetworkSettings> {
  const g = globalThis as Record<symbol, Cache | undefined>;
  const cached = g[CACHE_KEY];
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;
  const row = await prisma.instanceConfig.findUnique({
    where: { id: 1 },
    select: {
      networkFullAccess: true,
      networkOtherAccess: true,
      networkOtherRead: true,
      networkOtherWrite: true,
      networkOtherDownload: true,
      networkOtherUpload: true,
    },
  });
  const settings: NetworkSettings = row
    ? {
        fullAccess: row.networkFullAccess,
        access: row.networkOtherAccess,
        read: row.networkOtherRead,
        write: row.networkOtherWrite,
        download: row.networkOtherDownload,
        upload: row.networkOtherUpload,
      }
    : { fullAccess: [], access: true, read: true, write: true, download: true, upload: true };
  g[CACHE_KEY] = { at: Date.now(), settings };
  return settings;
}

export function networkSettingsChanged(): void {
  delete (globalThis as Record<symbol, unknown>)[CACHE_KEY];
}
