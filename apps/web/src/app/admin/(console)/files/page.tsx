import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import {
  MAX_FILE_SIZE_MB_LIMIT,
  getAllowedUploadExtensions,
  getMaxUploadSizeMb,
  getStorageSettingsView,
} from "@/lib/storage";
import styles from "@/styles/ui.module.css";
import { StorageSettingsForm } from "../storage-settings-form";
import { UploadLimitForm } from "../upload-limit-form";
import { UploadTypesForm } from "../upload-types-form";

export default async function AdminFilesPage() {
  await requireAdmin(["SITE_ADMIN"]);
  const [storage, fileCount, maxUploadSizeMb, allowedExtensions] = await Promise.all([
    getStorageSettingsView(),
    prisma.fileObject.count(),
    getMaxUploadSizeMb(),
    getAllowedUploadExtensions(),
  ]);

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>追加できるファイルの種類</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          ページに追加（ドラッグ＆ドロップ・貼り付け・ファイルの選択）できるファイルを、拡張子で限定します。ここにない拡張子のファイルと、拡張子のないファイルは追加できなくなります。
          初期状態は、文書・Office・画像・音声と動画・zip のおすすめの一覧です（プログラムやスクリプト、HTML・SVG、マクロ付きの Office ファイルは入れていません）。すでに添付されているファイルには影響しません。Word ファイルを展開するときは、中の画像（png・jpg・gif・webp）も添付されるため、それらの拡張子も必要です。
        </p>
        <UploadTypesForm current={allowedExtensions} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>アップロードの上限</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          エディタに添付できる1ファイルの最大サイズです。保存先（同梱・外部）に関係なく適用されます。初期値は 100MB です。
        </p>
        <UploadLimitForm current={maxUploadSizeMb} maxLimitMb={MAX_FILE_SIZE_MB_LIMIT} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ファイル保存</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          ページに添付したファイルの保存先（S3 互換ストレージ）です。ファイルは暗号化して保存され、ナレッジルートのメンバーだけが取り出せます。
          保存先の変更はインフラ作業として扱い、既存ファイルの移行は手動で行ってください（README「ファイル保存の移行」）。
        </p>
        <StorageSettingsForm current={storage} fileCount={fileCount} />
      </section>
    </>
  );
}
