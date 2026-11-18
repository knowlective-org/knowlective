import { mcpEnabled } from "@/lib/mcp/auth";
import { type OAuthClientView, findClient } from "./clients";
import { mcpResourceUrl, oauthIssuer } from "./metadata";
import { isValidCodeChallenge, parseScope, redirectUriMatches, redirectWith } from "./params";

// An authorization request (/oauth/authorize), checked: by the consent page
// before showing it, and again by its Server Action (the form's fields come
// back from the browser). Until the redirect URI is known to be the app's,
// problems are shown here and nobody is sent anywhere; after that, they go
// back to the app as OAuth errors (RFC 6749 4.1.2.1).

export type AuthorizeRequest = {
  client: OAuthClientView;
  redirectUri: string;
  codeChallenge: string;
  state: string | undefined;
  // The app asked to write (the person may still allow reading only).
  write: boolean;
};

export type AuthorizeShown = "disabled" | "unknownClient" | "badRedirect";

export type AuthorizeProblem = { shown: AuthorizeShown } | { redirect: string };

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

// Where to send the person back to with an error or the code: with `state`
// and the issuer (RFC 9207, so the app knows which server answered).
export async function backToApp(redirectUri: string, state: string | undefined, params: Record<string, string>): Promise<string> {
  return redirectWith(redirectUri, { ...params, state, iss: await oauthIssuer() });
}

export async function checkAuthorizeRequest(params: Record<string, unknown>): Promise<AuthorizeRequest | AuthorizeProblem> {
  if (!(await mcpEnabled())) return { shown: "disabled" };
  const client = await findClient(params.client_id);
  if (!client) return { shown: "unknownClient" };
  let redirectUri = str(params.redirect_uri);
  // Optional when the app registered exactly one (RFC 6749 3.1.2.3).
  if (redirectUri === undefined && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (!redirectUri || !redirectUriMatches(redirectUri, client.redirectUris)) return { shown: "badRedirect" };

  const state = str(params.state);
  const fail = async (error: string, description: string): Promise<AuthorizeProblem> => ({
    redirect: await backToApp(redirectUri, state, { error, error_description: description }),
  });
  if (params.response_type !== "code") return fail("unsupported_response_type", "response_type must be code.");
  if (params.code_challenge_method !== "S256" || !isValidCodeChallenge(params.code_challenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method S256 is required.");
  }
  // Tokens are only for the MCP server (RFC 8707).
  const resource = str(params.resource);
  if (resource !== undefined && resource.replace(/\/$/, "") !== (await mcpResourceUrl())) {
    return fail("invalid_target", "resource must be this site's MCP server.");
  }
  return {
    client,
    redirectUri,
    codeChallenge: params.code_challenge as string,
    state,
    write: parseScope(params.scope).write,
  };
}
