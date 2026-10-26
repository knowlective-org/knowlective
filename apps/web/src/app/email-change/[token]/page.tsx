import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { findEmailChange } from "@/lib/auth/email-change";
import styles from "@/styles/ui.module.css";
import { ConfirmEmailChangeForm } from "./confirm-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("emailChange.title") }), robots: { index: false, follow: false } };
}

// Opened from the link mailed to the new address (lib/auth/email-change.ts).
// The link alone decides the account, signed in or not; the change is made by
// the confirm button.
export default async function EmailChangePage({ params }: PageProps<"/email-change/[token]">) {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const { token } = await params;
  const request = await findEmailChange(token);
  const t = await getTranslations("emailChange");

  return (
    <main className={styles.narrow} data-ui="EmailChangePage">
      <h1 className={styles.title}>{t("heading")}</h1>
      {request ? (
        <>
          <p className={styles.lead} data-ui="EmailChangePage.summary">
            {t("summary", { from: request.currentEmail, to: request.newEmail })}
          </p>
          <ConfirmEmailChangeForm token={token} />
        </>
      ) : (
        <>
          <p className={styles.lead} data-ui="EmailChangePage.invalid">
            {t("invalid")}
          </p>
          <p className={styles.note}>
            <Link href="/account" data-ui="EmailChangePage.accountLink">
              {t("toAccount")}
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
