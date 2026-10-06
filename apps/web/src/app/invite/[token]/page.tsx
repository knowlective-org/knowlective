import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MIN_PASSWORD_LENGTH, isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { findValidInvitation } from "@/lib/auth/invitations";
import { SITE_ROLE_LABELS } from "@/lib/roles";
import { getCurrentUser } from "@/lib/auth/session";
import styles from "@/styles/ui.module.css";
import { AcceptForm, RegisterForm } from "./invite-forms";

export const metadata: Metadata = {
  title: "招待 | yosuga",
  robots: { index: false, follow: false },
};


export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const { token } = await params;
  const invitation = await findValidInvitation(token);

  if (!invitation) {
    return (
      <main className={styles.narrow}>
        <h1 className={styles.title}>招待リンクが無効です</h1>
        <p className={styles.lead}>
          このリンクは使用済みか、期限が切れています。管理者に新しいリンクを依頼してください。
        </p>
        <Link href="/login">ログイン画面へ</Link>
      </main>
    );
  }

  const groupNames = invitation.groups.map((g) => `「${g.group.name}」`).join("");
  const description =
    `${SITE_ROLE_LABELS[invitation.siteRole]}として招待されています。` +
    (groupNames ? `登録すると、グループ${groupNames}に参加します。` : "");

  const user = await getCurrentUser();
  return (
    <main className={styles.narrow}>
      <h1 className={styles.title}>yosuga への招待</h1>
      <p className={styles.lead}>{description}</p>
      {user ? (
        <>
          <p className={styles.lead}>
            {user.name ?? user.email} としてログインしています。参加すると、招待のグループに追加されます（ロールは変わりません）。
          </p>
          <AcceptForm token={token} />
        </>
      ) : (
        <>
          <RegisterForm token={token} email={invitation.email} minLength={MIN_PASSWORD_LENGTH} />
          <p className={styles.note} style={{ marginTop: 24 }}>
            すでにアカウントをお持ちの場合は、
            <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>ログイン</Link>
            してから、このリンクをもう一度開いてください。
          </p>
        </>
      )}
    </main>
  );
}
