import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A minimal OpenID Connect provider for the tests, on this machine (http on
// 127.0.0.1, which the app accepts as a development issuer): discovery,
// authorize (answers at once, as if the person had logged in), token (a
// signed ID token), JWKS and UserInfo. `idToken` and `userInfo` are the
// claims it hands out; change them between sign-ins.

export type MockIdp = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  idToken: Record<string, unknown>;
  userInfo: Record<string, unknown>;
  close(): Promise<void>;
};

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export async function startMockIdp(subject: string): Promise<MockIdp> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string | null }>();
  const tokens = new Set<string>();

  const idp: MockIdp = {
    issuer: "",
    clientId: "e2e-client",
    clientSecret: "e2e-secret",
    idToken: {},
    userInfo: {},
    close: async () => {},
  };

  const jwt = (payload: Record<string, unknown>) => {
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "e2e" }));
    const body = b64url(JSON.stringify(payload));
    const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey);
    return `${head}.${body}.${b64url(signature)}`;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", idp.issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: idp.issuer,
        authorization_endpoint: `${idp.issuer}/authorize`,
        token_endpoint: `${idp.issuer}/token`,
        userinfo_endpoint: `${idp.issuer}/userinfo`,
        jwks_uri: `${idp.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const code = randomBytes(16).toString("hex");
      codes.set(code, { nonce: url.searchParams.get("nonce") });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const grant = codes.get(params.get("code") ?? "");
        if (!grant) return json(400, { error: "invalid_grant" });
        codes.delete(params.get("code")!);
        const accessToken = randomBytes(16).toString("hex");
        tokens.add(accessToken);
        const now = Math.floor(Date.now() / 1000);
        json(200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 300,
          id_token: jwt({
            iss: idp.issuer,
            sub: subject,
            aud: idp.clientId,
            iat: now,
            exp: now + 300,
            ...(grant.nonce ? { nonce: grant.nonce } : {}),
            at_hash: b64url(createHash("sha256").update(accessToken).digest().subarray(0, 16)),
            ...idp.idToken,
          }),
        });
      });
      return;
    }
    if (url.pathname === "/userinfo") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!tokens.has(token)) return json(401, { error: "invalid_token" });
      return json(200, { sub: subject, ...idp.userInfo });
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  idp.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  idp.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return idp;
}
