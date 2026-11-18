"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showConfirm, showCopyText } from "@/components/dialog";
import { showNotice } from "@/components/notice";
import styles from "@/styles/ui.module.css";
import { disconnectApp } from "./mcp-actions";

export type ConnectedApp = {
  id: string;
  name: string;
  scope: "READ" | "WRITE";
  createdAt: string;
  lastUsedAt: string | null;
};

// AI apps connected over MCP (lib/oauth/): the server's address to give an
// app, and the apps connected so far, each of which can be disconnected.
export function McpSection({ url, apps, available }: { url: string; apps: ConnectedApp[]; available: boolean }) {
  const t = useTranslations("account.mcp");
  const format = useFormatter();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div data-ui="McpSection" style={{ display: "grid", gap: 16 }}>
      <p className={styles.note}>{t("lead")}</p>
      {available ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <code data-ui="McpSection.url" style={{ wordBreak: "break-all" }}>
            {url}
          </code>
          <button
            type="button"
            className={styles.buttonSecondary}
            data-ui="McpSection.copyButton"
            onClick={() => {
              // The clipboard API exists only on https (or localhost): on a
              // plain-http intranet site, show the address to copy by hand.
              if (!navigator.clipboard) {
                void showCopyText(t("urlHint"), url, { title: t("urlTitle") });
                return;
              }
              navigator.clipboard
                .writeText(url)
                .then(() => showNotice(t("copied")))
                .catch(() => showCopyText(t("urlHint"), url, { title: t("urlTitle") }));
            }}
          >
            {t("copy")}
          </button>
        </div>
      ) : (
        <p className={styles.note} data-ui="McpSection.unavailable">
          {t("unavailable")}
        </p>
      )}
      {apps.length === 0 ? (
        <p className={styles.note} data-ui="McpSection.empty">
          {t("none")}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("app")}</th>
                <th>{t("scope")}</th>
                <th>{t("connectedAt")}</th>
                <th>{t("lastUsedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} data-ui="McpSection.row" data-id={a.id}>
                  <td>{a.name || t("unnamed")}</td>
                  <td>{t(`scopes.${a.scope}`)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{date(a.createdAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{a.lastUsedAt ? date(a.lastUsedAt) : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={pending}
                      data-ui="McpSection.disconnectButton"
                      data-id={a.id}
                      onClick={async () => {
                        const ok = await showConfirm(t("disconnectConfirm", { name: a.name || t("unnamed") }), {
                          title: t("disconnectTitle"),
                          confirmLabel: t("disconnect"),
                          danger: true,
                        });
                        if (!ok) return;
                        setPending(true);
                        try {
                          await disconnectApp(a.id);
                        } finally {
                          setPending(false);
                        }
                        router.refresh();
                      }}
                    >
                      {t("disconnect")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
