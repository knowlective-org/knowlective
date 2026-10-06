import { isInsecurePublicUrl } from "shared";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { getMailSettings } from "@/lib/mail";
import { getRequestOrigin } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { MailSettingsForm, TestMailForm } from "./mail-settings-form";
import { PublicUrlForm } from "./public-url-form";
import { StorageSettingsForm } from "./storage-settings-form";
import { MAX_FILE_SIZE_MB_LIMIT, getMaxUploadSizeMb, getStorageSettingsView } from "@/lib/storage";
import { UploadLimitForm } from "./upload-limit-form";

export default async function AdminOverviewPage() {
  await requireAdmin(["SITE_ADMIN"]);
  const [mail, site, requestOrigin, siteAdminCount, storage, fileCount, maxUploadSizeMb] = await Promise.all([
    getMailSettings(),
    prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { publicUrl: true } }),
    getRequestOrigin(),
    prisma.user.count({ where: { siteRole: "SITE_ADMIN", disabledAt: null } }),
    getStorageSettingsView(),
    prisma.fileObject.count(),
    getMaxUploadSizeMb(),
  ]);

  return (
    <>
      {siteAdminCount === 0 && (
        <p className={styles.error} style={{ marginBottom: 24 }}>
          サイト管理者のロールを持つユーザーがまだいません。「ユーザー」でユーザーのロールを「サイト管理者」にすると、そのユーザーは自分のアカウントで管理画面にログインできます。
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>サイトの設定</h2>
        {site.publicUrl === null && (
          <p className={styles.error} style={{ marginBottom: 12 }}>
            公開 URL が未設定です。設定するまでは、招待リンクやメールのリンクに、今アクセスしている URL（{requestOrigin}）が使われます。
          </p>
        )}
        {site.publicUrl !== null && isInsecurePublicUrl(site.publicUrl) && (
          <p className={styles.error} style={{ marginBottom: 12 }}>
            公開 URL が http:// です。本番では https:// を使ってください（ログイン情報が暗号化されずに送られます）。
          </p>
        )}
        <PublicUrlForm current={site.publicUrl} suggested={requestOrigin} />
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ファイル保存</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          ページに添付したファイルの保存先（S3 互換ストレージ）です。ファイルは暗号化して保存され、ナレッジルートのメンバーだけが取り出せます。
          保存先の変更はインフラ作業として扱い、既存ファイルの移行は手動で行ってください（README「ファイル保存の移行」）。
        </p>
        <StorageSettingsForm current={storage} fileCount={fileCount} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>アップロードの上限</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          エディタに添付できる1ファイルの最大サイズです。保存先（同梱・外部）に関係なく適用されます。初期値は 100MB です。
        </p>
        <UploadLimitForm current={maxUploadSizeMb} maxLimitMb={MAX_FILE_SIZE_MB_LIMIT} />
      </section>
    </>
  );
}
