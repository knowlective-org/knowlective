import { headers } from "next/headers";
import { getClientIp } from "./ip";

export type RequestContext = { ip: string; userAgent: string | null; secure: boolean };

export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  return {
    ip: getClientIp(h),
    userAgent: h.get("user-agent"),
    // Set by the reverse proxy; see the README section on running in production.
    secure: h.get("x-forwarded-proto") === "https",
  };
}

// The origin the browser used for this request, as reported by Next.js (or
// the reverse proxy). Only a fallback/suggestion: links that leave the site
// (emails, invitations) should use getPublicUrl() instead, since Host headers
// are client-controlled.
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${proto}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`;
}
