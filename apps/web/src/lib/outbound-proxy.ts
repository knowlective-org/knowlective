import http from "node:http";
import https from "node:https";
import { type PrismaClient, decrypt, encrypt, loadDataKey } from "shared";
import { type OutboundProxy, proxyAgent, proxyForHost } from "./proxy-bypass";

export { type OutboundProxy, proxyAgent, proxyForHost };

// The forward proxy the server's own connections to the outside go through,
// set in /admin (InstanceConfig.outboundProxy*): link previews
// (lib/link-preview.ts), desktop notifications (server/notifications.ts),
// single sign-on (lib/auth/oidc.ts), mail (lib/mail.ts) and file storage
// (lib/storage.ts; not the bundled SeaweedFS). Hosts on the bypass list
// (lib/proxy-bypass.ts) and this machine are reached directly. The password
// is encrypted with the data key.
//
// Takes the PrismaClient (the app's or the custom server's): both use it.
// A new connection to the outside must ask proxyUrlFor() (or use
// fetchThroughProxy()) too.

// Kept from when the proxy was the link previews' own: the stored password
// is bound to it.
const PASSWORD_AAD = "knowlective:link-preview-proxy-password";

// What /admin shows: no password.
export type OutboundProxySettingsView = {
  // http(s)://host:port, without credentials.
  url: string | null;
  username: string | null;
  hasPassword: boolean;
  bypass: string[];
};

export async function getOutboundProxySettings(prisma: PrismaClient): Promise<OutboundProxySettingsView> {
  const config = await prisma.instanceConfig.findUniqueOrThrow({
    where: { id: 1 },
    select: { outboundProxyUrl: true, outboundProxyUsername: true, outboundProxyPasswordEnc: true, outboundProxyBypass: true },
  });
  return {
    url: config.outboundProxyUrl,
    username: config.outboundProxyUsername,
    hasPassword: config.outboundProxyPasswordEnc !== null,
    bypass: config.outboundProxyBypass,
  };
}

export type OutboundProxySettingsInput = {
  url: string | null;
  username: string | null;
  // undefined = keep the stored password; string = replace it.
  password: string | undefined;
  bypass: string[];
};

export async function saveOutboundProxySettings(prisma: PrismaClient, input: OutboundProxySettingsInput): Promise<void> {
  // No proxy, or a proxy without a user: no password to keep.
  const keepsPassword = input.url !== null && input.username !== null;
  await prisma.instanceConfig.update({
    where: { id: 1 },
    data: {
      outboundProxyUrl: input.url,
      outboundProxyUsername: input.url ? input.username : null,
      outboundProxyBypass: input.bypass,
      ...(!keepsPassword
        ? { outboundProxyPasswordEnc: null }
        : input.password !== undefined
          ? {
              outboundProxyPasswordEnc: Uint8Array.from(
                encrypt(await loadDataKey(prisma), Buffer.from(input.password, "utf8"), PASSWORD_AAD),
              ),
            }
          : {}),
    },
  });
  outboundProxyChanged();
}

// Read for every connection, so kept a few seconds; on globalThis, so saving
// in the app clears it for the custom server too (they're separate bundles).
const CACHE_MS = 5_000;
type Cache = { at: number; proxy: OutboundProxy | null };
const store = globalThis as typeof globalThis & { __knowlectiveOutboundProxy?: Cache | null };

export function outboundProxyChanged(): void {
  store.__knowlectiveOutboundProxy = null;
}

export async function loadOutboundProxy(prisma: PrismaClient): Promise<OutboundProxy | null> {
  const cached = store.__knowlectiveOutboundProxy;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.proxy;
  const config = await prisma.instanceConfig.findUnique({
    where: { id: 1 },
    select: { outboundProxyUrl: true, outboundProxyUsername: true, outboundProxyPasswordEnc: true, outboundProxyBypass: true },
  });
  let proxy: OutboundProxy | null = null;
  if (config?.outboundProxyUrl) {
    const url = new URL(config.outboundProxyUrl);
    if (config.outboundProxyUsername) {
      url.username = encodeURIComponent(config.outboundProxyUsername);
      if (config.outboundProxyPasswordEnc) {
        const key = await loadDataKey(prisma);
        url.password = encodeURIComponent(decrypt(key, config.outboundProxyPasswordEnc, PASSWORD_AAD).toString("utf8"));
      }
    }
    proxy = { url: url.href, bypass: config.outboundProxyBypass };
  }
  store.__knowlectiveOutboundProxy = { at: Date.now(), proxy };
  return proxy;
}

// The proxy to reach `target` (a URL, or a host name) through, or null.
export async function proxyUrlFor(prisma: PrismaClient, target: string | URL): Promise<string | null> {
  const host = target instanceof URL ? target.hostname : URL.canParse(target) ? new URL(target).hostname : target;
  return proxyForHost(await loadOutboundProxy(prisma), host);
}

const FETCH_TIMEOUT_MS = 30_000;

// fetch() that goes through the proxy when there is one for the URL (for
// libraries that take a fetch, such as openid-client). Node's fetch can't be
// given a proxy without the undici package, so a proxied request is made
// with http(s).request and returned as a Response.
// What such libraries pass (openid-client's CustomFetchOptions).
type FetchInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string | URLSearchParams | Uint8Array | ArrayBuffer | ReadableStream | null;
  signal?: AbortSignal | null;
  redirect?: RequestRedirect;
};

export function fetchThroughProxy(prisma: PrismaClient) {
  return async (url: string, init: FetchInit = {}): Promise<Response> => {
    const proxy = await proxyUrlFor(prisma, url);
    return proxy ? fetchVia(proxy, new URL(url), init) : fetch(url, init as RequestInit);
  };
}

// A request through `proxy`, as fetch() would make it. (Redirects aren't
// followed: openid-client asks for none.)
export async function fetchVia(proxy: string, url: URL, init: FetchInit): Promise<Response> {
  const headers = new Headers(init.headers);
  let body: string | Buffer | undefined;
  if (init.body instanceof URLSearchParams) {
    body = init.body.toString();
    if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  } else if (typeof init.body === "string") body = init.body;
  else if (init.body instanceof ArrayBuffer) body = Buffer.from(init.body);
  else if (init.body instanceof Uint8Array) body = Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength);
  else if (init.body) body = Buffer.from(await new Response(init.body).arrayBuffer());
  const method = init.method ?? "GET";
  const secure = url.protocol === "https:";
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(
      url,
      {
        method,
        headers: Object.fromEntries(headers),
        agent: proxyAgent(proxy, secure),
        signal: init.signal ?? undefined,
        timeout: FETCH_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, v);
          }
          const status = response.statusCode ?? 502;
          const empty = method === "HEAD" || [101, 204, 205, 304].includes(status);
          resolve(
            new Response(empty ? null : new Uint8Array(Buffer.concat(chunks)), {
              status,
              statusText: response.statusMessage,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}
