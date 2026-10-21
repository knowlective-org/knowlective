import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser, getPasskeySetupUser, safeNextPath } from "@/lib/auth/session";
import styles from "@/styles/ui.module.css";
import { logout } from "../(app)/actions";
import { PasskeySetupForm } from "./passkey-setup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("passkeySetup.title") }) };
}

// The site requires passkeys and this account (signed in with its password)
// has none: nothing else opens until one is registered (lib/auth/session.ts).
export default async function PasskeySetupPage({ searchParams }: PageProps<"/passkey-setup">) {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const next = safeNextPath((await searchParams).next);
  const user = await getPasskeySetupUser();
  if (!user) redirect((await getCurrentUser()) ? next : `/login?next=${encodeURIComponent(next)}`);
  const t = await getTranslations("passkeySetup");

  return (
    <main className={styles.narrow} data-ui="PasskeySetupPage">
      <h1 className={styles.title}>{t("heading")}</h1>
      <p className={styles.note} style={{ marginBottom: 8 }}>
        {t("lead")}
      </p>
      <p className={styles.note} style={{ marginBottom: 24 }} data-ui="PasskeySetupPage.email">
        {t("account", { email: user.email })}
      </p>
      <PasskeySetupForm next={next} />
      <form action={logout} style={{ marginTop: 24 }}>
        <button type="submit" className={styles.buttonSecondary} data-ui="PasskeySetupPage.logoutButton">
          {t("logout")}
        </button>
      </form>
    </main>
  );
}
