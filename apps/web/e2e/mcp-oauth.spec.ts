import { type Page, expect, test } from "@playwright/test";
import {
  Client,
  type OAuthClientInformationMixed,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { authFile } from "./accounts";
import { withPrisma } from "./db";

// Connecting an MCP client with OAuth (lib/oauth/): the client finds this
// site's authorization server from the MCP server's 401, registers itself,
// and sends the person to the consent screen; they allow it, and the client
// exchanges the code for tokens. Then the tokens act as the person, and stop
// when the connection is ended on the account screen. The app's redirect
// URI (a loopback address, as desktop apps use) is answered by the test.

const CALLBACK = "http://127.0.0.1:47819/callback";

async function setMcp(on: boolean) {
  await withPrisma((prisma) =>
    prisma.instanceConfig.update({
      where: { id: 1 },
      data: { apiEnabled: on, mcpEnabled: on, apiKeyRoles: ["SITE_ADMIN", "CONTENT_MANAGER", "USER"] },
    }),
  );
}

// An MCP client's OAuth state, in memory, as an app would keep it.
class TestProvider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = "";
  authorizationUrl: URL | null = null;
  constructor(private readonly scope = "read write") {}
  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata() {
    return {
      client_name: "E2E のアプリ",
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: this.scope,
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
  // Kept with the verifier, so the SDK can check the code comes from the
  // server it started with.
  discovery: OAuthDiscoveryState | undefined;
  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.discovery = state;
  }
  discoveryState() {
    return this.discovery;
  }
}

function transportFor(baseURL: string, provider: TestProvider) {
  return new StreamableHTTPClientTransport(new URL("api/mcp", baseURL), { authProvider: provider });
}

// Starts connecting: the client discovers, registers, and asks to send the
// person to the consent screen.
async function startConnecting(baseURL: string, provider: TestProvider) {
  const transport = transportFor(baseURL, provider);
  const client = new Client({ name: "e2e-oauth", version: "0" });
  await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
  expect(provider.authorizationUrl).not.toBeNull();
  return transport;
}

// Opens the consent screen, answers, and returns where the browser was sent.
async function answerConsent(page: Page, url: URL, answer: (page: Page) => Promise<void>): Promise<URL> {
  let landed: URL | null = null;
  await page.route(`${CALLBACK}**`, async (route) => {
    landed = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
  });
  await page.goto(url.href);
  await answer(page);
  await expect.poll(() => landed).not.toBeNull();
  return landed!;
}

test.describe("MCP over OAuth", () => {
  test.use({ storageState: authFile("editor") });

  test.beforeEach(async () => {
    await setMcp(true);
  });

  test.afterEach(async () => {
    await setMcp(false);
    await withPrisma(async (prisma) => {
      await prisma.oAuthClient.deleteMany({ where: { name: "E2E のアプリ" } });
    });
  });

  test("the person allows the app on the consent screen; its tokens act as them until disconnected", async ({ page, baseURL }) => {
    const provider = new TestProvider();
    const transport = await startConnecting(baseURL!, provider);
    const back = await answerConsent(page, provider.authorizationUrl!, async (p) => {
      await expect(p.getByTestId("ConsentForm.heading")).toContainText("E2E のアプリ");
      await expect(p.getByTestId("ConsentForm.target")).toContainText("127.0.0.1:47819");
      await expect(p.getByTestId("ConsentForm.writeRadio")).toBeChecked();
      await p.getByTestId("ConsentForm.allowButton").click();
    });
    expect(back.searchParams.get("code")).toBeTruthy();
    expect(back.searchParams.get("iss")).toBe(new URL(baseURL!).href.replace(/\/$/, ""));
    await transport.finishAuth(back.searchParams);
    expect(provider.saved?.access_token).toMatch(/^kna_/);

    const client = new Client({ name: "e2e-oauth", version: "0" });
    await client.connect(transportFor(baseURL!, provider));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("append_to_page");
    const page1 = (await client.callTool({ name: "get_page", arguments: { pageId: "e2e-home" } })) as { content: { text: string }[] };
    expect(JSON.parse(page1.content[0].text).id).toBe("e2e-home");
    await client.close();

    // Listed on the account screen, and disconnected there.
    await page.unroute(`${CALLBACK}**`);
    await page.goto("account");
    const row = page.getByTestId("McpSection.row").filter({ hasText: "E2E のアプリ" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("閲覧と書き込み");
    await row.getByTestId("McpSection.disconnectButton").click();
    await page.getByTestId("AppDialog.confirmButton").click();
    await expect(page.getByTestId("McpSection.row").filter({ hasText: "E2E のアプリ" })).toHaveCount(0);

    const after = await fetch(new URL("api/mcp", baseURL), {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.saved!.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  test("read only: chosen on the consent screen, the app gets the reading tools only", async ({ page, baseURL }) => {
    const provider = new TestProvider();
    const transport = await startConnecting(baseURL!, provider);
    const back = await answerConsent(page, provider.authorizationUrl!, async (p) => {
      await p.getByTestId("ConsentForm.readRadio").check();
      await p.getByTestId("ConsentForm.allowButton").click();
    });
    await transport.finishAuth(back.searchParams);
    expect(provider.saved?.scope).toBe("read");
    const client = new Client({ name: "e2e-oauth", version: "0" });
    await client.connect(transportFor(baseURL!, provider));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("search");
    expect(names).not.toContain("append_to_page");
    await client.close();
  });

  test("denied: the app gets access_denied and no code", async ({ page, baseURL }) => {
    const provider = new TestProvider();
    await startConnecting(baseURL!, provider);
    const back = await answerConsent(page, provider.authorizationUrl!, (p) => p.getByTestId("ConsentForm.denyButton").click());
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(back.searchParams.get("state")).toBe(provider.authorizationUrl!.searchParams.get("state"));
  });

  test("a code works once; a refresh token rotates, and a used one ends the connection", async ({ page, baseURL }) => {
    const provider = new TestProvider();
    const transport = await startConnecting(baseURL!, provider);
    const back = await answerConsent(page, provider.authorizationUrl!, (p) => p.getByTestId("ConsentForm.allowButton").click());
    await transport.finishAuth(back.searchParams);
    const clientId = provider.info!.client_id;
    const token = (params: Record<string, string>) =>
      fetch(new URL("oauth/token", baseURL), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, ...params }),
      });

    // The same code again: refused.
    const again = await token({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri: CALLBACK,
      code_verifier: provider.verifier,
    });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");

    // Presenting the code twice ended the connection: start over.
    const second = new TestProvider();
    const transport2 = await startConnecting(baseURL!, second);
    const back2 = await answerConsent(page, second.authorizationUrl!, (p) => p.getByTestId("ConsentForm.allowButton").click());
    await transport2.finishAuth(back2.searchParams);
    const first = second.saved!.refresh_token!;
    const refreshed = await token({ grant_type: "refresh_token", refresh_token: first, client_id: second.info!.client_id });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as OAuthTokens;
    expect(next.refresh_token).not.toBe(first);

    // The old refresh token again: refused, and the new tokens stop too.
    const reused = await token({ grant_type: "refresh_token", refresh_token: first, client_id: second.info!.client_id });
    expect((await reused.json()).error).toBe("invalid_grant");
    const call = await fetch(new URL("api/mcp", baseURL), {
      method: "POST",
      headers: { Authorization: `Bearer ${next.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(call.status).toBe(401);
  });

  test("an unregistered redirect URI is shown as an error, and nobody is sent there", async ({ page, baseURL }) => {
    const provider = new TestProvider();
    await startConnecting(baseURL!, provider);
    const url = new URL(provider.authorizationUrl!);
    url.searchParams.set("redirect_uri", "https://evil.example/steal");
    await page.goto(url.href);
    await expect(page.getByTestId("OAuthAuthorizePage.error")).toBeVisible();
    expect(new URL(page.url()).host).toBe(new URL(baseURL!).host);
  });

  test("the discovery documents name this site", async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).href.replace(/\/$/, "");
    const resource = await (await request.get(".well-known/oauth-protected-resource/api/mcp")).json();
    expect(resource.resource).toBe(`${origin}/api/mcp`);
    expect(resource.authorization_servers).toEqual([origin]);
    const server = await (await request.get(".well-known/oauth-authorization-server")).json();
    expect(server.issuer).toBe(origin);
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(server.client_id_metadata_document_supported).toBe(true);
  });
});
