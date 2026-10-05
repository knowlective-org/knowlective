import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser, safeNextPath } from "@/lib/auth/session";
import styles from "@/styles/ui.module.css";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ログイン | yosuga",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");

  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <main className={styles.narrow}>
      <h1 className={styles.title}>yosuga にログイン</h1>
      <LoginForm next={next} />
      <p className={styles.note} style={{ marginTop: 24 }}>
        アカウントは招待制です。管理者から届いた招待リンクから登録してください。
      </p>
    </main>
  );
}
