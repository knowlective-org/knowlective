import { lookup } from "node:dns";
import { lookup as lookupAsync } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, type LookupFunction, isIP } from "node:net";

// Title, description and image of a web page, for the リンクのプレビュー block.
//
// The server fetches a URL chosen by a user, so this is the one place where
// the app makes requests on someone's behalf. It must not become a way to
// reach what only the server can reach (the database, the storage, cloud
// metadata, the intranet): addresses that aren't allowed are refused — when
// the name is resolved for the connection itself, so a name can't pass the
// check and then resolve to something else — and so is every redirect target.
//
// What is allowed is set in /admin (lib/link-preview-settings.ts):
// - public addresses only (the default), or private (intranet) ones too;
// - never the server itself (loopback), link-local addresses (where cloud
//   providers keep instance credentials), multicast or reserved ranges.
// With a proxy, the proxy makes the connection: the name is still checked
// here when this server can resolve it, but what it finally reaches is up to
// the proxy's own rules.

export type FetchOptions = {
  // Also fetch from private (intranet) addresses.
  allowPrivate: boolean;
  // http://host:port of a forward proxy (credentials as user:password@).
  proxyUrl: string | null;
};

export type LinkPreview = {
  // Where the page ended up after redirects.
  url: string;
  title: string;
  description: string;
  // Absolute http(s) URL of the page's preview image, or "".
  image: string;
  siteName: string;
};

const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 6000;
// The tags we read are in <head>; no need for more of the page.
const MAX_BYTES = 512 * 1024;
const MAX_URL_LENGTH = 2000;

// Never fetched from, whatever the settings.
const never = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["127.0.0.0", 8], // loopback: the server itself
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["192.0.0.0", 24],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  never.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 127], // unspecified, loopback
  ["64:ff9b::", 96], // NAT64
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  never.addSubnet(net, prefix, "ipv6");
}

// Private networks: only when the administrators allow the intranet.
const privateNets = new BlockList();
for (const [net, prefix] of [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  privateNets.addSubnet(net, prefix, "ipv4");
}
privateNets.addSubnet("fc00::", 7, "ipv6"); // unique local

export function isAllowedAddress(address: string, allowPrivate: boolean): boolean {
  let family = isIP(address);
  if (family === 0) return false;
  // IPv4 written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) {
    address = mapped[1];
    family = 4;
  }
  const type = family === 4 ? "ipv4" : "ipv6";
  if (never.check(address, type)) return false;
  return allowPrivate || !privateNets.check(address, type);
}

// Resolves the host for the connection, leaving out addresses that aren't
// allowed. Used as the socket's own lookup, so what is checked is what is
// connected to.
const checkedLookup =
  (allowPrivate: boolean): LookupFunction =>
  (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const allowed = addresses.filter((a) => isAllowedAddress(a.address, allowPrivate));
      if (allowed.length === 0) return callback(new Error("address not allowed"), "", 0);
      if (options.all) callback(null, allowed);
      else callback(null, allowed[0].address, allowed[0].family);
    });
  };

// A forward proxy's URL as an administrator may enter it, or null.
export function parseProxyUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || url.pathname !== "/" || url.search || url.hash) return null;
  return url;
}

export function parsePreviewUrl(raw: string, allowPrivate = false): URL | null {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // An address written directly isn't looked up, so it's checked here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isAllowedAddress(host, allowPrivate)) return null;
  return url;
}

type Fetched = { status: number; location?: string; contentType: string; body: Buffer };

// Through a proxy the connection is the proxy's, so the socket's lookup can't
// check the destination. Check what this server resolves the name to instead;
// a name it can't resolve (common where only the proxy sees the outside) is
// left to the proxy.
async function resolvesToAllowed(url: URL, allowPrivate: boolean): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isAllowedAddress(host, allowPrivate);
  try {
    const addresses = await lookupAsync(host, { all: true });
    return addresses.some((a) => isAllowedAddress(a.address, allowPrivate));
  } catch {
    return true;
  }
}

function get(url: URL, options: FetchOptions): Promise<Fetched> {
  const secure = url.protocol === "https:";
  // Node's own proxy support (http.Agent `proxyEnv`, Node 24.5+): plain
  // requests go through the proxy, https ones through a CONNECT tunnel.
  const agent = options.proxyUrl
    ? new (secure ? https : http).Agent({
        proxyEnv: { HTTP_PROXY: options.proxyUrl, HTTPS_PROXY: options.proxyUrl },
      } as http.AgentOptions)
    : undefined;
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(
      url,
      {
        method: "GET",
        agent,
        // Without a proxy the destination is checked as it's connected to.
        lookup: agent ? undefined : checkedLookup(options.allowPrivate),
        timeout: TIMEOUT_MS,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ja,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; KNOWLECTIVE-link-preview)",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            contentType: String(response.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
          });
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BYTES) {
            done();
            request.destroy();
          }
        });
        response.on("end", done);
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

const clean = (text: string | undefined, max: number) =>
  decodeEntities(text ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// The page's text. Japanese sites still use Shift_JIS and EUC-JP, declared in
// the response header or in a <meta> near the top.
function decodeHtml(body: Buffer, contentType: string): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function parsePreview(html: string, pageUrl: URL): LinkPreview {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  let image = "";
  const rawImage = clean(meta.get("og:image") ?? meta.get("twitter:image"), MAX_URL_LENGTH);
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") image = resolved.href;
    } catch {
      // Not a usable URL.
    }
  }
  return {
    url: pageUrl.href,
    title: clean(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, 200),
    description: clean(meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description"), 300),
    image,
    siteName: clean(meta.get("og:site_name"), 80),
  };
}

// The preview of `raw`, or null if it can't be had: not an http(s) URL, an
// address that isn't allowed, not an HTML page, an error, a timeout.
export async function fetchLinkPreview(
  raw: string,
  options: FetchOptions = { allowPrivate: false, proxyUrl: null },
): Promise<LinkPreview | null> {
  let url = parsePreviewUrl(raw, options.allowPrivate);
  try {
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      if (options.proxyUrl && !(await resolvesToAllowed(url, options.allowPrivate))) return null;
      const response = await get(url, options);
      if (response.status >= 300 && response.status < 400 && response.location) {
        // Checked like the first URL: a redirect is the classic way around.
        url = parsePreviewUrl(new URL(response.location, url).href, options.allowPrivate);
        continue;
      }
      if (response.status < 200 || response.status >= 300) return null;
      if (!/^(text\/html|application\/xhtml\+xml)/i.test(response.contentType)) return null;
      return parsePreview(decodeHtml(response.body, response.contentType), url);
    }
  } catch {
    // Unreachable, refused, timed out.
  }
  return null;
}
