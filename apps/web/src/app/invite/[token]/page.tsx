import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MIN_PASSWORD_LENGTH, isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { findValidInvitation } from "@/lib/auth/invitations";
import { getCurrentUser } from "@/lib/auth/session";
import { getSignupSettings, isDomainAllowed } from "@/lib/auth/signup";
import styles from "@/styles/ui.module.css";
import { AcceptForm, RegisterForm } from "./invite-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("invite.title") }), robots: { index: false, follow: false } };
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const { token } = await params;
  const invitation = await findValidInvitation(token);
  // A self-signup link stops working if signup was turned off (or its
  // domain removed) after it was sent.
  const signup = invitation?.selfSignup ? await getSignupSettings() : null;
  const signupClosed =
    signup !== null && (!signup.enabled || !isDomainAllowed(invitation!.email ?? "", signup.allowedDomains));
  const t = await getTranslations();

  if (!invitation || signupClosed) {
    return (
      <main className={styles.narrow} data-ui="InvitePage">
        <h1 className={styles.title}>{signup ? t("invite.signupInvalidTitle") : t("invite.invalidTitle")}</h1>
        <p className={styles.lead}>
          {signupClosed ? t("common.errors.signupClosed") : signup ? t("invite.signupExpired") : t("invite.expired")}
        </p>
        <Link href="/login" data-ui="InvitePage.loginLink">{t("invite.toLogin")}</Link>
      </main>
    );
  }

  const groupNames = invitation.groups.map((g) => g.group.name);
  const description = [
    t("invite.invitedAs", { role: t(`roles.${invitation.siteRole}`) }),
    ...(groupNames.length > 0 ? [t("invite.joinsGroups", { groups: groupNames.join(t("common.listSeparator")) })] : []),
  ].join(t("common.sentenceSeparator"));

  const user = await getCurrentUser();
  if (invitation.selfSignup) {
    return (
      <main className={styles.narrow} data-ui="InvitePage">
        <h1 className={styles.title}>{t("invite.signupHeading")}</h1>
        {user ? (
          <p className={styles.lead}>
            {t.rich("invite.alreadyLoggedIn", {
              name: user.name ?? user.email,
              link: (chunks) => <Link href="/">{chunks}</Link>,
            })}
          </p>
        ) : (
          <>
            <p className={styles.lead}>{t("invite.signupLead")}</p>
            <RegisterForm token={token} email={invitation.email} minLength={MIN_PASSWORD_LENGTH} />
          </>
        )}
      </main>
    );
  }
  return (
    <main className={styles.narrow} data-ui="InvitePage">
      <h1 className={styles.title}>{t("invite.heading")}</h1>
      <p className={styles.lead}>{description}</p>
      {user ? (
        <>
          <p className={styles.lead}>{t("invite.loggedInAs", { name: user.name ?? user.email })}</p>
          <AcceptForm token={token} />
        </>
      ) : (
        <>
          <RegisterForm token={token} email={invitation.email} minLength={MIN_PASSWORD_LENGTH} />
          <p className={styles.note} style={{ marginTop: 24 }}>
            {t.rich("invite.existingAccount", {
              link: (chunks) => (
                <Link data-ui="InvitePage.existingAccountLoginLink" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </>
      )}
    </main>
  );
}
