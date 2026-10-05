import { BlockList, isIP } from "node:net";

// Client IP resolution.
//
// Next.js only fills in X-Forwarded-For from the socket when the header is
// absent (`??=` in next/dist/server/base-server.js), so a client talking to
// Next.js directly can send any value it likes. The trustworthy entry is the
// one appended by the last reverse proxy we control: counting from the right,
// skip YOSUGA_TRUSTED_PROXY_HOPS - 1 entries.
//
// Default 1 is correct both for local dev (no proxy: Next.js adds the socket
// address) and for a single reverse proxy (nginx/Caddy) in front. Exposing
// Next.js directly to the internet makes the IP spoofable — always deploy
// behind a reverse proxy.
function trustedHops(): number {
  const n = Number(process.env.YOSUGA_TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  // IPv4-mapped IPv6 (::ffff:192.0.2.1) → plain IPv4, so allowlists written
  // as IPv4 still match on dual-stack sockets.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

export function getClientIp(headers: Headers): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return "unknown";
  const index = Math.max(0, entries.length - trustedHops());
  return normalizeIp(entries[index]);
}

export type ParsedCidr = { network: string; prefix: number; family: "ipv4" | "ipv6" };

// Accepts "192.0.2.0/24", "2001:db8::/32", or a bare address (= single host).
export function parseCidr(input: string): ParsedCidr | null {
  const [addr, prefixStr, ...rest] = input.trim().split("/");
  if (rest.length > 0) return null;
  const network = normalizeIp(addr);
  const version = isIP(network);
  if (version === 0) return null;
  const max = version === 4 ? 32 : 128;
  const prefix = prefixStr === undefined ? max : Number(prefixStr);
  if (!/^\d+$/.test(prefixStr ?? String(max)) || prefix < 0 || prefix > max) return null;
  return { network, prefix, family: version === 4 ? "ipv4" : "ipv6" };
}

export function formatCidr(c: ParsedCidr): string {
  return `${c.network}/${c.prefix}`;
}

// An empty allowlist means "no restriction".
export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const family = isIP(ip);
  if (family === 0) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    const c = parseCidr(entry);
    if (c) list.addSubnet(c.network, c.prefix, c.family);
  }
  return list.check(ip, family === 4 ? "ipv4" : "ipv6");
}
