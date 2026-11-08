import { getTranslations } from "next-intl/server";
import styles from "@/styles/ui.module.css";

// An admin page as an auditor sees it (requireAdminView()'s `readOnly`):
// every control disabled, under a note saying so. Not what keeps them from
// changing anything — every Server Action refuses them (requireAdmin()).
export async function AdminReadOnly({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  if (!readOnly) return <>{children}</>;
  const t = await getTranslations("admin.auditorView");
  return (
    <>
      <p className={styles.readOnlyNote} role="status" data-ui="AdminReadOnly.status">
        {t("note")}
      </p>
      <fieldset disabled className={styles.readOnly} data-ui="AdminReadOnly">
        {children}
      </fieldset>
    </>
  );
}
