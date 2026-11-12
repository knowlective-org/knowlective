"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { showConfirm, showTypedConfirm } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { deleteKnowledgeRoot, restoreKnowledgeRoot } from "./actions";

// Submitted once the dialog is accepted (the form stays on the page while
// it's open). Without JavaScript the form still posts, unconfirmed.
function confirmed(ask: () => Promise<boolean>) {
  return (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    if (form.dataset.confirmed) {
      delete form.dataset.confirmed;
      return;
    }
    e.preventDefault();
    void ask().then((ok) => {
      if (!ok) return;
      form.dataset.confirmed = "1";
      form.requestSubmit();
    });
  };
}

export function DeleteRootButton({ rootId, name, pages }: { rootId: string; name: string; pages: number }) {
  const t = useTranslations("admin.roots");
  return (
    <form
      action={deleteKnowledgeRoot}
      onSubmit={confirmed(() =>
        showTypedConfirm(t("deleteConfirm", { name, pages }), { title: t("deleteTitle"), confirmLabel: t("delete") }),
      )}
      data-ui="DeleteRootButton"
    >
      <input type="hidden" name="rootId" value={rootId} />
      <button type="submit" className={styles.danger} data-ui="DeleteRootButton.submitButton">
        {t("delete")}
      </button>
    </form>
  );
}

export function RestoreRootButton({ rootId, name }: { rootId: string; name: string }) {
  const t = useTranslations("admin.roots");
  return (
    <form
      action={restoreKnowledgeRoot}
      onSubmit={confirmed(() => showConfirm(t("restoreConfirm", { name }), { title: t("restoreTitle"), confirmLabel: t("restore") }))}
      data-ui="RestoreRootButton"
    >
      <input type="hidden" name="rootId" value={rootId} />
      <button type="submit" className={styles.buttonSecondary} data-ui="RestoreRootButton.submitButton">
        {t("restore")}
      </button>
    </form>
  );
}
