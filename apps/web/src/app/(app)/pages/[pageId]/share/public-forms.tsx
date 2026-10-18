"use client";

import { useTranslations } from "next-intl";
import { confirmBeforeSubmit } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { publishPage, unpublishPage } from "./actions";

// The buttons of the share screen's publishing section, each
// confirmed first.

export function PublishForm({ pageId }: { pageId: string }) {
  const t = useTranslations("share");
  return (
    <form
      action={publishPage}
      data-ui="PublishForm"
      onSubmit={(e) =>
        confirmBeforeSubmit(
          e,
          t("publishConfirm"),
          { title: t("publishTitle"), confirmLabel: t("publishLabel"), danger: true },
        )
      }
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className={styles.danger} data-ui="PublishForm.submitButton">
        {t("publish")}
      </button>
    </form>
  );
}

export function UnpublishForm({ pageId }: { pageId: string }) {
  const t = useTranslations("share");
  return (
    <form
      action={unpublishPage}
      data-ui="UnpublishForm"
      onSubmit={(e) =>
        confirmBeforeSubmit(e, t("unpublishConfirm"), {
          title: t("unpublishTitle"),
          confirmLabel: t("unpublishLabel"),
        })
      }
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className={styles.button} data-ui="UnpublishForm.submitButton">
        {t("unpublishLabel")}
      </button>
    </form>
  );
}
