"use server";

import { requireUser } from "@/lib/auth/session";
import { auditTranslator } from "@/i18n/audit";
import { recordAudit, userLabel } from "@/lib/audit";
import { backToApp, checkAuthorizeRequest } from "@/lib/oauth/authorize";
import { createAuthorization, oauthAllowedFor } from "@/lib/oauth/tokens";

export type ConsentResult = { to: string } | { error: "disabled" | "notAllowed" | "unknownClient" | "badRedirect" };

// The answer on the consent screen. The request is checked again (its fields
// come back from the browser), and the person may narrow what they allow
// (read only), never widen it. Returns where to send them: back to the app,
// with the code or with access_denied. The page goes there itself, as the
// app's address may be another site or an app's own scheme.
export async function answerConsent(formData: FormData): Promise<ConsentResult> {
  const user = await requireUser();
  const request = await checkAuthorizeRequest(Object.fromEntries(formData));
  if ("shown" in request) return { error: request.shown };
  if ("redirect" in request) return { to: request.redirect };
  if (formData.get("decision") !== "allow") {
    return { to: await backToApp(request.redirectUri, request.state, { error: "access_denied", error_description: "The person declined." }) };
  }
  if (!(await oauthAllowedFor(user.siteRole))) return { error: "notAllowed" };
  const write = request.write && formData.get("allow") === "write";
  const { code, grantId } = await createAuthorization({
    userId: user.id,
    clientId: request.client.id,
    write,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
  });
  const audit = await auditTranslator();
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "mcp.connect",
    audit("audit.mcpConnect", { app: request.client.name || audit("audit.mcpUnnamedApp"), write: String(write) }),
    { grantId, clientId: request.client.id, scope: write ? "WRITE" : "READ" },
  );
  return { to: await backToApp(request.redirectUri, request.state, { code }) };
}
