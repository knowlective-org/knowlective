import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { formatCidr, normalizeIp, parseCidr } from "./ip";

// Which hosts the server reaches directly, not through the outbound proxy
// (lib/outbound-proxy.ts): the administrator's list, and always this machine.
// No dependencies (unit tested: test/proxy-bypass.test.ts); the settings
// themselves are read by lib/outbound-proxy.ts.
//
// An entry is a host name ("mail.example.co.jp": that host only), a domain
// (".example.co.jp" or "*.example.co.jp": the domain and every host under
// it), an address, or a range of addresses ("10.0.0.0/8").

export const MAX_BYPASS_ENTRIES = 100;

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

// One entry as stored, or null if it isn't one.
export function parseBypassEntry(raw: string): string | null {
  const entry = raw.trim().toLowerCase();
  if (!entry) return null;
  const domain = /^(?:\*\.|\.)(.+)$/.exec(entry);
  if (domain) return HOST_NAME.test(domain[1]) ? `.${domain[1]}` : null;
  if (entry.includes("/") || isIP(normalizeIp(entry.replace(/^\[|\]$/g, ""))) !== 0) {
    const cidr = parseCidr(entry.replace(/^\[|\]$/g, ""));
    return cidr ? formatCidr(cidr) : null;
  }
  return HOST_NAME.test(entry) ? entry : null;
}

// The entries of a list typed one per line (commas and spaces also
// separate), and those that aren't entries. Duplicates are dropped.
export function parseBypassList(raw: string): { entries: string[]; invalid: string[] } {
  const entries: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    if (!part) continue;
    const entry = parseBypassEntry(part);
    if (entry === null) invalid.push(part);
    else if (!entries.includes(entry)) entries.push(entry);
  }
  return { entries, invalid };
}

// This machine: never through the proxy.
function isLocal(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ip = normalizeIp(host);
  if (isIP(ip) === 4) return ip.startsWith("127.");
  return ip === "::1";
}

// Whether `host` (a URL's hostname; IPv6 with or without brackets) is reached
// directly.
export function bypassesProxy(host: string, entries: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isLocal(name)) return true;
  const ip = normalizeIp(name);
  const family = isIP(ip);
  if (family !== 0) {
    const list = new BlockList();
    for (const entry of entries) {
      const cidr = entry.startsWith(".") ? null : parseCidr(entry);
      if (cidr) list.addSubnet(cidr.network, cidr.prefix, cidr.family);
    }
    return list.check(ip, family === 4 ? "ipv4" : "ipv6");
  }
  return entries.some((entry) => (entry.startsWith(".") ? name === entry.slice(1) || name.endsWith(entry) : name === entry));
}

// The proxy (its URL with the credentials in it) and the hosts reached
// directly.
export type OutboundProxy = { url: string; bypass: string[] };

// The proxy to reach `host` through, or null to connect directly.
export function proxyForHost(proxy: OutboundProxy | null, host: string): string | null {
  return proxy && !bypassesProxy(host, proxy.bypass) ? proxy.url : null;
}

// An agent that sends requests through `proxyUrl`: plain http ones as proxy
// requests, https ones through a CONNECT tunnel (Node's own proxy support,
// http.Agent `proxyEnv`, Node 24.5+).
export function proxyAgent(proxyUrl: string, secure: boolean): http.Agent {
  return new (secure ? https : http).Agent({
    proxyEnv: { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl },
  } as http.AgentOptions);
}
