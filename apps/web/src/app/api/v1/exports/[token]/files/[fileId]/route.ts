import { apiError } from "@/lib/api/http";
import { getClientIp } from "@/lib/ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { exportFile } from "@/lib/page-transfer/export";

type Context = RouteContext<"/api/v1/exports/[token]/files/[fileId]">;

const limited = createRateLimiter(60_000, 1200);

// auth: public — the one-time token is the authorization: an attachment of the pages its link gave, until it expires (lib/page-transfer/export.ts).
export async function GET(request: Request, ctx: Context) {
  const retryAfter = limited(getClientIp(request.headers));
  if (retryAfter !== null) return apiError("rate_limited", "Too many requests. Wait a moment.", { "Retry-After": String(retryAfter) });
  const { token, fileId } = await ctx.params;
  const file = await exportFile(token, fileId);
  if (!file) return apiError("not_found", "No such file for this link, or the link has expired.");
  // Never shown here: always a download.
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
