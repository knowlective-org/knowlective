import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { OIDC_START_PATH, OIDC_STATE_COOKIE, OidcLoginError, finishLogin } from "@/lib/auth/oidc";
import { createUserSession } from "@/lib/auth/session";
import { getRequestContext } from "@/lib/request";

// GET /auth/oidc/callback — where the IdP sends the browser back. Register
// `<public URL>/auth/oidc/callback` as the redirect URI at the IdP.
// Relative Location: behind the reverse proxy, request.url's host may be internal.
const redirect = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const stateCookie = jar.get(OIDC_STATE_COOKIE)?.value;
  // Single use, whatever happens next.
  jar.delete({ name: OIDC_STATE_COOKIE, path: OIDC_START_PATH.replace("/start", "") });

  try {
    const { userId, next } = await finishLogin(request.nextUrl.search, stateCookie);
    await createUserSession(await getRequestContext(), userId);
    return redirect(next);
  } catch (err) {
    const code = err instanceof OidcLoginError ? err.code : "failed";
    if (!(err instanceof OidcLoginError) || code === "failed") console.error("[oidc] sign-in failed", err);
    return redirect(`/login?sso_error=${code}`);
  }
}
