"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { restorePresentationSnapshot } from "@/app/(app)/pages/[pageId]/presentation-actions";
import { showAlert, showConfirm } from "@/components/dialog";
import styles from "@/styles/ui.module.css";

export type SnapshotItem = {
  id: string;
  createdAt: string;
  kind: "AUTO" | "BEFORE_RESTORE" | "RESTORED";
  slides: number;
  by: string | null;
};

// A presentation's snapshots, newest first: how it was made up at each time.
// Restoring brings back its slides, their order and content, the notes and
// the settings; what it replaces is kept as a snapshot first.
export function PresentationHistory({ pageId, snapshots, canRestore }: { pageId: string; snapshots: SnapshotItem[]; canRestore: boolean }) {
  const t = useTranslations("presentation");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const restore = async (snapshot: SnapshotItem) => {
    const when = format.dateTime(new Date(snapshot.createdAt), { dateStyle: "medium", timeStyle: "short" });
    if (!(await showConfirm(t("restoreConfirm", { when }), { danger: true }))) return;
    startTransition(async () => {
      const result = await restorePresentationSnapshot(pageId, snapshot.id);
      if ("error" in result) {
        await showAlert(result.error);
        return;
      }
      setStatus(result.skipped > 0 ? t("restoredSkipped", { n: result.skipped }) : t("restored"));
      router.refresh();
    });
  };

  return (
    <section data-ui="PresentationHistory">
      <h2 className={styles.sectionTitle}>{t("historyHeading")}</h2>
      {status && (
        <p className={styles.note} role="status" data-ui="PresentationHistory.status">
          {status}
        </p>
      )}
      {snapshots.length === 0 ? (
        <p className={styles.note} data-ui="PresentationHistory.emptyStatus">
          {t("historyEmpty")}
        </p>
      ) : (
        <div role="list">
          {snapshots.map((s) => (
            <div
              key={s.id}
              role="listitem"
              data-ui="PresentationHistory.snapshotRow"
              data-id={s.id}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}
            >
              <span style={{ flex: 1 }}>
                {format.dateTime(new Date(s.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                {" · "}
                {t("historySlides", { n: s.slides })}
                {s.kind !== "AUTO" && ` · ${t(`historyKinds.${s.kind}`)}`}
                {s.by && ` · ${s.by}`}
              </span>
              {canRestore && (
                <button type="button" className={styles.buttonSecondary} disabled={pending} onClick={() => void restore(s)} data-ui="PresentationHistory.restoreButton">
                  {t("restore")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
