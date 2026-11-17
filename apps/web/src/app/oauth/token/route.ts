import { mcpEnabled } from "@/lib/mcp/auth";
import { limitPerAddress, oauthError, oauthJson, preflight, readParams } from "@/lib/oauth/http";
import { exchangeCode, refreshTokens } from "@/lib/oauth/tokens";

// The token endpoint (lib/oauth/): an authorization code (with its PKCE
// verifier) or a refresh token, for tokens. Public clients only: the code's
// verifier, not a secret, proves the caller is the app that asked.

const limited = limitPerAddress(60_000, 60);

// auth: public — the code or refresh token in the body is the credential (lib/oauth/tokens.ts)
export async function POST(request: Request) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  if (!(await mcpEnabled())) return oauthError("invalid_request", "The MCP server is turned off on this site.", 404);
  const params = await readParams(request);
  if (!params) return oauthError("invalid_request", "Send the parameters as a form (application/x-www-form-urlencoded).");
  let result;
  if (params.grant_type === "authorization_code") {
    result = await exchangeCode({
      clientId: params.client_id,
      code: params.code,
      redirectUri: params.redirect_uri,
      codeVerifier: params.code_verifier,
    });
  } else if (params.grant_type === "refresh_token") {
    result = await refreshTokens({ clientId: params.client_id, refreshToken: params.refresh_token });
  } else {
    return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  }
  if ("error" in result) return oauthError(result.error, result.error_description);
  return oauthJson(result);
}

// auth: public — CORS preflight
export async function OPTIONS() {
  return preflight();
}
