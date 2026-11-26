"use client";

import { useTranslations } from "next-intl";
import { confirmBeforeSubmit } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { hidePublicPage, publishPage, unhidePublicPage, unpublishPage } from "./actions";

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

// A page made public by a page above: kept out of it, with the pages under it.
export function HidePublicForm({ pageId }: { pageId: string }) {
  const t = useTranslations("share");
  return (
    <form
      action={hidePublicPage}
      data-ui="HidePublicForm"
      onSubmit={(e) => confirmBeforeSubmit(e, t("hidePublicConfirm"), { title: t("hidePublicTitle"), confirmLabel: t("hidePublicLabel") })}
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className={styles.button} data-ui="HidePublicForm.submitButton">
        {t("hidePublic")}
      </button>
    </form>
  );
}

// Following the pages above again: public again when one of them is
// (`above`), so confirmed as publishing is.
export function UnhidePublicForm({ pageId, above }: { pageId: string; above: boolean }) {
  const t = useTranslations("share");
  return (
    <form
      action={unhidePublicPage}
      data-ui="UnhidePublicForm"
      onSubmit={(e) => {
        if (above) confirmBeforeSubmit(e, t("unhidePublicConfirm"), { title: t("unhidePublicTitle"), confirmLabel: t("unhidePublicLabel"), danger: true });
      }}
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className={above ? styles.danger : styles.button} data-ui="UnhidePublicForm.submitButton">
        {above ? t("unhidePublic") : t("unhidePublicNothingAbove")}
      </button>
    </form>
  );
}
