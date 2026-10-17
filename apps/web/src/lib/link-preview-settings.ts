import { decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import type { FetchOptions } from "@/lib/link-preview";

// Whether and how the server fetches pages for リンクのプレビュー blocks, set
// in /admin (InstanceConfig.linkPreview*). The proxy password is encrypted
// with the instance data key.

const PASSWORD_AAD = "knowlective:link-preview-proxy-password";

const select = {
  linkPreviewEnabled: true,
  linkPreviewAllowPrivate: true,
  linkPreviewProxyUrl: true,
  linkPreviewProxyUsername: true,
} as const;

// What /admin shows: no password.
export type LinkPreviewSettingsView = {
  enabled: boolean;
  allowPrivate: boolean;
  // http(s)://host:port, without credentials.
  proxyUrl: string | null;
  proxyUsername: string | null;
  hasProxyPassword: boolean;
};

export async function getLinkPreviewSettings(): Promise<LinkPreviewSettingsView> {
  const [config, withPassword] = await Promise.all([
    prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select }),
    prisma.instanceConfig.count({ where: { id: 1, linkPreviewProxyPasswordEnc: { not: null } } }),
  ]);
  return {
    enabled: config.linkPreviewEnabled,
    allowPrivate: config.linkPreviewAllowPrivate,
    proxyUrl: config.linkPreviewProxyUrl,
    proxyUsername: config.linkPreviewProxyUsername,
    hasProxyPassword: withPassword > 0,
  };
}

export async function isLinkPreviewEnabled(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { linkPreviewEnabled: true } });
  return config?.linkPreviewEnabled ?? false;
}

// How to fetch, or null when previews are turned off.
export async function getLinkPreviewFetchOptions(): Promise<FetchOptions | null> {
  const config = await prisma.instanceConfig.findUnique({
    where: { id: 1 },
    select: { ...select, linkPreviewProxyPasswordEnc: true },
  });
  if (!config?.linkPreviewEnabled) return null;
  let proxyUrl: string | null = null;
  if (config.linkPreviewProxyUrl) {
    const url = new URL(config.linkPreviewProxyUrl);
    if (config.linkPreviewProxyUsername) {
      url.username = config.linkPreviewProxyUsername;
      if (config.linkPreviewProxyPasswordEnc) {
        const key = await loadDataKey(prisma);
        url.password = decrypt(key, config.linkPreviewProxyPasswordEnc, PASSWORD_AAD).toString("utf8");
      }
    }
    proxyUrl = url.href;
  }
  return { allowPrivate: config.linkPreviewAllowPrivate, proxyUrl };
}

export type LinkPreviewSettingsInput = {
  enabled: boolean;
  allowPrivate: boolean;
  proxyUrl: string | null;
  proxyUsername: string | null;
  // undefined = keep the stored password; string = replace it.
  proxyPassword: string | undefined;
};

export async function saveLinkPreviewSettings(input: LinkPreviewSettingsInput): Promise<void> {
  // No proxy, or a proxy without a user: no password to keep.
  const keepsPassword = input.proxyUrl !== null && input.proxyUsername !== null;
  await prisma.instanceConfig.update({
    where: { id: 1 },
    data: {
      linkPreviewEnabled: input.enabled,
      linkPreviewAllowPrivate: input.allowPrivate,
      linkPreviewProxyUrl: input.proxyUrl,
      linkPreviewProxyUsername: input.proxyUrl ? input.proxyUsername : null,
      ...(!keepsPassword
        ? { linkPreviewProxyPasswordEnc: null }
        : input.proxyPassword !== undefined
          ? {
              linkPreviewProxyPasswordEnc: Uint8Array.from(
                encrypt(await loadDataKey(prisma), Buffer.from(input.proxyPassword, "utf8"), PASSWORD_AAD),
              ),
            }
          : {}),
    },
  });
}
