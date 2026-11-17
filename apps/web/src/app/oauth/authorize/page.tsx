import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { userLabel } from "@/lib/audit";
import { checkAuthorizeRequest } from "@/lib/oauth/authorize";
import { redirectTarget } from "@/lib/oauth/params";
import { oauthAllowedFor } from "@/lib/oauth/tokens";
import styles from "@/styles/ui.module.css";
import { ConsentForm } from "./consent-form";

// OAuth's authorization endpoint (lib/oauth/): an AI app sends the person
// here to connect it to their account. Signed in (the usual login, back here
// afterwards), they see what the app calls itself, where they'll be sent
// back to, and what it may do, then allow or deny.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("oauth");
  return { title: t("title"), robots: { index: false } };
}

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"];

export default async function OAuthAuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const key of FIELDS) if (typeof raw[key] === "string") params[key] = raw[key];
  const t = await getTranslations("oauth");

  const request = await checkAuthorizeRequest(params);
  if ("redirect" in request) redirect(request.redirect);
  const problem = (message: string) => (
    <main className={styles.narrow} data-ui="OAuthAuthorizePage">
      <h1 className={styles.title}>{t("title")}</h1>
      <p className={styles.error} data-ui="OAuthAuthorizePage.error">
        {message}
      </p>
    </main>
  );
  if ("shown" in request) return problem(t(`errors.${request.shown}`));

  const user = await requireUser(`/oauth/authorize?${new URLSearchParams(params)}`);
  if (!(await oauthAllowedFor(user.siteRole))) return problem(t("errors.notAllowed"));

  let site: string | null = null;
  try {
    site = request.client.clientUri ? new URL(request.client.clientUri).host : null;
  } catch {
    site = null;
  }
  return (
    <main className={styles.narrow} data-ui="OAuthAuthorizePage">
      <ConsentForm
        params={{ ...params, redirect_uri: request.redirectUri }}
        app={request.client.name || t("unnamed")}
        user={userLabel(user)}
        target={redirectTarget(request.redirectUri)}
        site={site}
        write={request.write}
      />
    </main>
  );
}
