import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireAdminView } from "@/lib/admin/auth";
import { AdminReadOnly } from "../admin-read-only";
import {
  MAX_FILE_SIZE_MB_LIMIT,
  getAllowedUploadExtensions,
  getMaxUploadSizeMb,
  getUploadsEnabled,
  getStorageSettingsView,
} from "@/lib/storage";
import styles from "@/styles/ui.module.css";
import { StorageSettingsForm } from "../storage-settings-form";
import { UploadLimitForm } from "../upload-limit-form";
import { UploadTypesForm } from "../upload-types-form";
import { UploadsEnabledForm } from "../uploads-enabled-form";

export default async function AdminFilesPage() {
  const { readOnly } = await requireAdminView(["SITE_ADMIN"]);
  const [storage, fileCount, maxUploadSizeMb, allowedExtensions, uploadsEnabled, t] = await Promise.all([
    getStorageSettingsView(),
    prisma.fileObject.count(),
    getMaxUploadSizeMb(),
    getAllowedUploadExtensions(),
    getUploadsEnabled(),
    getTranslations("admin.files"),
  ]);

  return (
    <AdminReadOnly readOnly={readOnly}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("uploads")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("uploadsLead")}
        </p>
        <UploadsEnabledForm enabled={uploadsEnabled} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("types")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("typesLead")} {t("typesLead2")}
        </p>
        <UploadTypesForm current={allowedExtensions} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("limit")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("limitLead")}
        </p>
        <UploadLimitForm current={maxUploadSizeMb} maxLimitMb={MAX_FILE_SIZE_MB_LIMIT} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("storage")}</h2>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("storageLead")} {t("storageLead2")}
        </p>
        <StorageSettingsForm current={storage} fileCount={fileCount} />
      </section>
    </AdminReadOnly>
  );
}
