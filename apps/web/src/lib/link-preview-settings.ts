import { prisma } from "@/lib/db";
import type { FetchOptions } from "@/lib/link-preview";
import { loadOutboundProxy } from "@/lib/outbound-proxy";

// Whether and how the server fetches pages for link preview blocks, set
// in /admin (InstanceConfig.linkPreview*). They go through the outbound proxy
// (lib/outbound-proxy.ts) when there is one.

const select = {
  linkPreviewEnabled: true,
  linkPreviewAllowPrivate: true,
} as const;

export type LinkPreviewSettingsView = {
  enabled: boolean;
  allowPrivate: boolean;
};

export async function getLinkPreviewSettings(): Promise<LinkPreviewSettingsView> {
  const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select });
  return { enabled: config.linkPreviewEnabled, allowPrivate: config.linkPreviewAllowPrivate };
}

export async function isLinkPreviewEnabled(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { linkPreviewEnabled: true } });
  return config?.linkPreviewEnabled ?? false;
}

// How to fetch, or null when previews are turned off.
export async function getLinkPreviewFetchOptions(): Promise<FetchOptions | null> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select });
  if (!config?.linkPreviewEnabled) return null;
  return { allowPrivate: config.linkPreviewAllowPrivate, proxy: await loadOutboundProxy(prisma) };
}

export async function saveLinkPreviewSettings(input: LinkPreviewSettingsView): Promise<void> {
  await prisma.instanceConfig.update({
    where: { id: 1 },
    data: { linkPreviewEnabled: input.enabled, linkPreviewAllowPrivate: input.allowPrivate },
  });
}
