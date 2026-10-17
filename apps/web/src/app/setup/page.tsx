import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSetupComplete, MIN_MASTER_PASSWORD_LENGTH } from "shared";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/request";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "初期セットアップ | KNOWLECTIVE",
};

export default async function SetupPage() {
  await connection();
  if (await isSetupComplete(prisma)) {
    redirect("/");
  }

  return (
    <main style={{ maxWidth: 480, margin: "64px auto", padding: "0 16px" }} data-ui="SetupPage">
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>KNOWLECTIVE の初期セットアップ</h1>
      <p style={{ lineHeight: 1.7, marginBottom: 12 }}>
        このインスタンスを管理するためのマスターパスワードと、サイトの公開 URL を設定します。
        同時に、ページ内容を暗号化するための鍵を生成します。
      </p>
      <p style={{ lineHeight: 1.7, marginBottom: 24 }}>
        マスターパスワードは、サーバーの鍵（KNOWLECTIVE_SERVER_KEY）を失ったときに
        データを復旧する唯一の手段です。あとから変更・再発行はできないため、
        パスワードマネージャーなどで安全に保管してください。
      </p>
      <SetupForm minLength={MIN_MASTER_PASSWORD_LENGTH} suggestedUrl={await getRequestOrigin()} />
    </main>
  );
}
