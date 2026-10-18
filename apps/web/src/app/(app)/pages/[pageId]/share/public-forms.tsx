"use client";

import { confirmBeforeSubmit } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { publishPage, unpublishPage } from "./actions";

// The buttons of the share screen's publishing section, each
// confirmed first.

export function PublishForm({ pageId }: { pageId: string }) {
  return (
    <form
      action={publishPage}
      data-ui="PublishForm"
      onSubmit={(e) =>
        confirmBeforeSubmit(
          e,
          "このページと、その下のすべてのページを、ログインしていない人も含めて、URL を知っている誰でも読めるようにします。あとから下に作ったページも公開されます。",
          { title: "インターネットに公開しますか？", confirmLabel: "公開する", danger: true },
        )
      }
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className={styles.danger} data-ui="PublishForm.submitButton">
        インターネットに公開する
      </button>
    </form>
  );
}

export function UnpublishForm({ pageId }: { pageId: string }) {
  return (
    <form
      action={unpublishPage}
      data-ui="UnpublishForm"
      onSubmit={(e) =>
        confirmBeforeSubmit(e, "ログインしていない人は、このページとその下のページを見られなくなります。", {
          title: "公開をやめますか？",
          confirmLabel: "公開をやめる",
        })
      }
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className={styles.button} data-ui="UnpublishForm.submitButton">
        公開をやめる
      </button>
    </form>
  );
}
