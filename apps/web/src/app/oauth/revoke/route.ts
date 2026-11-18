import { limitPerAddress, oauthJson, preflight, readParams } from "@/lib/oauth/http";
import { revokeToken } from "@/lib/oauth/tokens";

// Token revocation (RFC 7009): an app disconnecting itself. A refresh token
// ends the whole connection; an access token only itself. Always 200, so
// tokens can't be probed.

const limited = limitPerAddress(60_000, 60);

// auth: public — holding the token is what allows revoking it
export async function POST(request: Request) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  const params = await readParams(request);
  if (params) await revokeToken(params.token, params.client_id);
  return oauthJson({});
}

// auth: public — CORS preflight
export async function OPTIONS() {
  return preflight();
}
