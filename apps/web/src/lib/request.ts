import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getClientIp } from "./ip";

export type RequestContext = { ip: string; userAgent: string | null; secure: boolean };

export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  return {
    ip: getClientIp(h),
    userAgent: h.get("user-agent"),
    // Whether cookies get Secure: the reverse proxy says the request came over
    // https (see the README section on running in production), or the site's
    // public URL is https — a proxy that terminates TLS without setting
    // X-Forwarded-Proto would otherwise get session cookies without Secure.
    secure: h.get("x-forwarded-proto") === "https" || (await publicUrlIsHttps()),
  };
}

async function publicUrlIsHttps(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { publicUrl: true } });
  return config?.publicUrl?.startsWith("https://") ?? false;
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
