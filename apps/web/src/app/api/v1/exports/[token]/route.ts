import { apiError, apiJson } from "@/lib/api/http";
import { getClientIp } from "@/lib/ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { takeExport } from "@/lib/page-transfer/export";

type Context = RouteContext<"/api/v1/exports/[token]">;

// Per address: tokens can't be guessed, and nobody needs many tries.
const limited = createRateLimiter(60_000, 30);

// auth: public — the one-time token is the authorization (lib/page-transfer/export.ts): made by someone who can see the pages, read with their access when fetched.
export async function GET(request: Request, ctx: Context) {
  const retryAfter = limited(getClientIp(request.headers));
  if (retryAfter !== null) return apiError("rate_limited", "Too many requests. Wait a moment.", { "Retry-After": String(retryAfter) });
  const { token } = await ctx.params;
  const bundle = await takeExport(token);
  if (!bundle) return apiError("not_found", "The link is unknown, expired or used already.");
  return apiJson(bundle);
}
