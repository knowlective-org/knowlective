import { withBasePath } from "@/lib/base-path";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { beginLogin, getOidcSettings, stateCookieHeader } from "@/lib/auth/oidc";
import { getAdminConfig } from "@/lib/admin/auth";
import { isIpAllowed } from "@/lib/ip";
import { getRequestContext } from "@/lib/request";

// GET /admin/login/sso — the admin login page's single sign-on button. Like
// /auth/oidc/start, but the callback starts an admin session (still followed
// by the authenticator code). Under /admin so the admin IP allowlist applies
// and the network policy doesn't, as for the rest of the admin console.
const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: withBasePath(location) } });

export async function GET() {
  if (!(await isSetupComplete(prisma))) return redirect("/setup");
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  if (!isIpAllowed(ctx.ip, config.adminIpAllowlist)) return new Response(null, { status: 404 });
  if (!(await getOidcSettings()).enabled) return redirect("/admin/login?sso_error=unavailable");

  let started: Awaited<ReturnType<typeof beginLogin>>;
  try {
    started = await beginLogin("/admin", "admin");
  } catch (err) {
    // IdP unreachable or misconfigured.
    console.error("[oidc] discovery failed", err);
    started = null;
  }
  if (!started) return redirect("/admin/login?sso_error=unavailable");
  return new Response(null, {
    status: 303,
    headers: { Location: started.url.href, "Set-Cookie": stateCookieHeader(started.cookie, ctx.secure) },
  });
}
