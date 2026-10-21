"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showAlert, showConfirm } from "@/components/dialog";
import { PasskeyRegisterForm } from "@/components/passkey-register-form";
import styles from "@/styles/ui.module.css";
import { removePasskey } from "./passkey-actions";

export type PasskeyItem = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

// The account's passkeys: listed, added, removed. `required`: the site
// requires one for this account (the last one can't be removed).
export function PasskeySection({ passkeys, required }: { passkeys: PasskeyItem[]; required: boolean }) {
  const t = useTranslations("account.passkeys");
  const format = useFormatter();
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <div data-ui="PasskeySection" style={{ display: "grid", gap: 16 }}>
      <p className={styles.note}>{required ? t("leadRequired") : t("lead")}</p>
      {passkeys.length === 0 ? (
        <p className={styles.note} data-ui="PasskeySection.empty">
          {t("none")}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("createdAt")}</th>
                <th>{t("lastUsedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {passkeys.map((p) => (
                <tr key={p.id} data-ui="PasskeySection.row" data-id={p.id}>
                  <td>{p.name}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{date(p.createdAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{p.lastUsedAt ? date(p.lastUsedAt) : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={removing !== null || (required && passkeys.length === 1)}
                      title={required && passkeys.length === 1 ? t("lastRequiredNote") : undefined}
                      data-ui="PasskeySection.removeButton"
                      data-id={p.id}
                      onClick={async () => {
                        const ok = await showConfirm(t("removeConfirm", { name: p.name }), {
                          title: t("removeTitle"),
                          confirmLabel: t("remove"),
                          danger: true,
                        });
                        if (!ok) return;
                        setRemoving(p.id);
                        try {
                          const result = await removePasskey(p.id);
                          if (result.error) await showAlert(result.error, { title: t("removeFailed") });
                          router.refresh();
                        } finally {
                          setRemoving(null);
                        }
                      }}
                    >
                      {t("remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PasskeyRegisterForm onRegistered={() => router.refresh()} />
    </div>
  );
}
