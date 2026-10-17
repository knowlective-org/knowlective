import { isInsecurePublicUrl } from "shared";
import { BASE_PATH } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { getMailSettings } from "@/lib/mail";
import { getRequestOrigin } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { MailSettingsForm, TestMailForm } from "./mail-settings-form";
import { PublicUrlForm } from "./public-url-form";

import { getTheme } from "@/lib/theme";
import { ThemeForm } from "./theme-form";
import { getLinkPreviewSettings } from "@/lib/link-preview-settings";
import { LinkPreviewSettingsForm } from "./link-preview-settings-form";
import { publicPageIds } from "@/lib/public-pages";
import { PublicPagesForm } from "./public-pages-form";

export default async function AdminOverviewPage() {
  await requireAdmin(["SITE_ADMIN"]);
  const [mail, site, requestOrigin, siteAdminCount, theme, linkPreview, publicCount] = await Promise.all([
    getMailSettings(),
    prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { publicUrl: true, publicPagesAllowed: true, searchEnginesAllowed: true } }),
    getRequestOrigin(),
    prisma.user.count({ where: { siteRole: "SITE_ADMIN", disabledAt: null } }),
    getTheme(),
    getLinkPreviewSettings(),
    publicPageIds().then((ids) => ids.length),
  ]);

  return (
    <>
      {siteAdminCount === 0 && (
        <p data-ui="AdminOverviewPage.noSiteAdminError" className={styles.error} style={{ marginBottom: 24 }}>
          サイト管理者のロールを持つユーザーがまだいません。「ユーザー」でユーザーのロールを「サイト管理者」にすると、そのユーザーは自分のアカウントで管理画面にログインできます。
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>サイトの設定</h2>
        {site.publicUrl === null && (
          <p data-ui="AdminOverviewPage.publicUrlUnsetError" className={styles.error} style={{ marginBottom: 12 }}>
            公開 URL が未設定です。設定するまでは、招待リンクやメールのリンクに、今アクセスしている URL（{requestOrigin}）が使われます。
          </p>
        )}
        {site.publicUrl !== null && isInsecurePublicUrl(site.publicUrl) && (
          <p data-ui="AdminOverviewPage.insecurePublicUrlError" className={styles.error} style={{ marginBottom: 12 }}>
            公開 URL が http:// です。本番では https:// を使ってください（ログイン情報が暗号化されずに送られます）。
          </p>
        )}
        <PublicUrlForm current={site.publicUrl} suggested={requestOrigin} />
        <p className={styles.note} style={{ marginTop: 16 }} data-ui="AdminOverviewPage.basePath">
          サブパス：{BASE_PATH ? <code>{BASE_PATH}</code> : "なし（ルートで公開）"}
          {site.publicUrl !== null && BASE_PATH && (
            <>
              {" "}
              — 外部に出すリンクは <code>{site.publicUrl + BASE_PATH}</code> から始まります。
            </>
          )}
          <br />
          サブパスは、サーバーの環境変数 <code>KNOWLECTIVE_BASE_PATH</code>（例: <code>/knowlective</code>）で指定し、再起動すると反映されます。この画面からは変更できません。
          公開 URL には、サブパスを含めずに入力してください。
        </p>
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.themeSection">
        <h2 className={styles.sectionTitle}>テーマ</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          サイト全体（ページ・管理画面・ログイン画面）の色です。保存すると、すべての利用者の画面に反映されます。
        </p>
        <ThemeForm current={theme} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>メール送信</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          パスワード再設定などのメールを送るための SMTP サーバーを設定します。パスワードは暗号化して保存され、画面には表示されません。
        </p>
        <MailSettingsForm current={mail} />
        <div style={{ marginTop: 24 }}>
          <TestMailForm disabled={mail === null} />
        </div>
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.linkPreviewSection">
        <h2 className={styles.sectionTitle}>リンクのプレビュー</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          ページの空の行に URL を貼り付けると、そのサイトのタイトル・説明・画像を表示するカードになります。
          タイトルなどは、貼り付けたときにこのサーバーが相手のサイトへ取りに行きます。
        </p>
        <LinkPreviewSettingsForm current={linkPreview} />
      </section>

      <section className={styles.section} data-ui="AdminOverviewPage.publicPagesSection">
        <h2 className={styles.sectionTitle}>ページの公開</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          ページを、ログインしていない人にも見せられるようにするかどうかです。「全ユーザー」（登録している人全員）よりも広い公開範囲です。
        </p>
        <PublicPagesForm
          allowed={site.publicPagesAllowed}
          searchEnginesAllowed={site.searchEnginesAllowed}
          publicCount={publicCount}
        />
      </section>

    </>
  );
}
