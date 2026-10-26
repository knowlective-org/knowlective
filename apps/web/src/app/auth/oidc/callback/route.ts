import { cookies } from "next/headers";
import { withBasePath } from "@/lib/base-path";
import type { NextRequest } from "next/server";
import { OIDC_STATE_COOKIE, OIDC_STATE_COOKIE_PATH, OidcLoginError, finishLogin, openState } from "@/lib/auth/oidc";
import { finishTestLogin } from "@/lib/auth/oidc-test";
import { beginAdminSessionAfterSso, getAdminConfig } from "@/lib/admin/auth";
import { createUserSession } from "@/lib/auth/session";
import { isIpAllowed } from "@/lib/ip";
import { requestNetworkCaps } from "@/lib/page-access";
import { getRequestContext } from "@/lib/request";

// GET /auth/oidc/callback — where the IdP sends the browser back. Register
// `<public URL>/auth/oidc/callback` as the redirect URI at the IdP.
// Relative Location: behind the reverse proxy, request.url's host may be internal.
// `location` is a path inside the app; a Route Handler's own Location header
// doesn't get the base path added.
const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: withBasePath(location) } });

// The admin session cookie is SameSite=Strict, and a redirect that continues
// the IdP's cross-site navigation wouldn't send it. A page of our own that
// moves on makes the next request same-site. `location` is a fixed path.
const sameSiteRedirect = (location: string) => {
  const href = withBasePath(location);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><a href="${href}">${href}</a>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
};

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const stateCookie = jar.get(OIDC_STATE_COOKIE)?.value;
  // Single use, whatever happens next.
  jar.delete({ name: OIDC_STATE_COOKIE, path: withBasePath(OIDC_STATE_COOKIE_PATH) });

  const state = await openState(stateCookie);
  // A test from the admin console: nobody is signed in; the result page
  // (which checks the admin session) shows what came back.
  if (state?.test) return sameSiteRedirect(`/admin/oidc-test/${await finishTestLogin(request.nextUrl.search, state, state.test)}`);

  try {
    const ctx = await getRequestContext();
    const { userId, next, purpose } = await finishLogin(request.nextUrl.search, state);
    if (purpose === "admin") {
      // The admin console's own restriction (this path is outside /admin).
      if (!isIpAllowed(ctx.ip, (await getAdminConfig()).adminIpAllowlist)) return new Response(null, { status: 404 });
      const step = await beginAdminSessionAfterSso(ctx, userId);
      if (step === "not_admin") return redirect("/admin/login?sso_error=not_admin");
      return sameSiteRedirect(step);
    }
    // This path is exempt from the network gate (the admin console's sign-in
    // comes back here from any network), so the app's sign-in checks it: a
    // network that may not use the site gets /login, which says so.
    if (!(await requestNetworkCaps()).access) return redirect("/login");
    await createUserSession(ctx, userId, "OIDC");
    return redirect(next);
  } catch (err) {
    const code = err instanceof OidcLoginError ? err.code : "failed";
    if (!(err instanceof OidcLoginError) || code === "failed") console.error("[oidc] sign-in failed", err);
    const page = err instanceof OidcLoginError && err.purpose === "admin" ? "/admin/login" : "/login";
    return redirect(`${page}?sso_error=${code}`);
  }
}
