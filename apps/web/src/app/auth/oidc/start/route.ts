import type { NextRequest } from "next/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { OIDC_START_PATH, OIDC_STATE_COOKIE, OIDC_STATE_MAX_AGE, beginLogin } from "@/lib/auth/oidc";
import { safeNextPath } from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";

// GET /auth/oidc/start?next=/pages/… — the login page's SSO button. Sends the
// browser to the IdP with a fresh state / nonce / PKCE challenge, kept in an
// encrypted cookie for the callback.
// Relative Location: behind the reverse proxy, request.url's host may be internal.
const redirect = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

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
  const cookie = [
    `${OIDC_STATE_COOKIE}=${started.cookie}`,
    // Only the callback needs it. Lax: sent on the IdP's top-level redirect back.
    `Path=${OIDC_START_PATH.replace("/start", "")}`,
    `Max-Age=${OIDC_STATE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, { status: 303, headers: { Location: started.url.href, "Set-Cookie": cookie } });
}
