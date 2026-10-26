import type { NextRequest } from "next/server";
import { withBasePath } from "@/lib/base-path";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { beginLogin, stateCookieHeader } from "@/lib/auth/oidc";
import { safeNextPath } from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";

// GET /auth/oidc/start?next=/pages/… — the login page's SSO button. Sends the
// browser to the IdP with a fresh state / nonce / PKCE challenge, kept in an
// encrypted cookie for the callback.
// Relative Location: behind the reverse proxy, request.url's host may be internal.
// `location` is a path inside the app; a Route Handler's own Location header
// doesn't get the base path added.
const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: withBasePath(location) } });

export async function GET(request: NextRequest) {
  if (!(await isSetupComplete(prisma))) return redirect("/setup");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  let started: Awaited<ReturnType<typeof beginLogin>>;
  try {
    started = await beginLogin(next);
  } catch (err) {
    // IdP unreachable or misconfigured.
    console.error("[oidc] discovery failed", err);
    started = null;
  }
  if (!started) return redirect("/login?sso_error=unavailable");

  const { secure } = await getRequestContext();
  return new Response(null, {
    status: 303,
    headers: { Location: started.url.href, "Set-Cookie": stateCookieHeader(started.cookie, secure) },
  });
}
