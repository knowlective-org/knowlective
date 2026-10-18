"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { type PageVersionKind } from "@/lib/page-versions";
import styles from "@/styles/ui.module.css";
import { loadVersion, restorePageVersion } from "./actions";
import historyStyles from "./history.module.css";
import { MaskPanel } from "./mask-panel";
import { showAlert, showConfirm } from "@/components/dialog";

function Loading() {
  const t = useTranslations("history");
  return <p className={styles.note}>{t("loading")}</p>;
}

// BlockNote touches `window`, so the preview never renders on the server.
const VersionPreview = dynamic(
  () => import("./version-preview").then((m) => m.VersionPreview),
  {
    ssr: false,
    loading: () => <Loading />,
  },
);

export type VersionItem = {
  id: string;
  createdAt: string;
  kind: PageVersionKind;
  title: string;
  editors: string[];
  restoredFromId: string | null;
  // Text in it was masked: shown masked, can't be restored.
  masked: boolean;
};

export function HistoryView({
  pageId,
  canRestore,
  versions,
}: {
  pageId: string;
  canRestore: boolean;
  versions: VersionItem[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    versions[0]?.id ?? null,
  );
  // Loaded state of the selected version (undefined while loading).
  const [loaded, setLoaded] = useState<
    { id: string; state: string } | null | undefined
  >(undefined);
  const [restoring, startRestore] = useTransition();
  // Bumped after masking, so the open preview is reloaded (now masked).
  const [reloadKey, setReloadKey] = useState(0);
  const t = useTranslations("history");
  const format = useFormatter();
  const dateTimeFormat = { format: (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) };
  const listSeparator = useTranslations("common")("listSeparator");

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    loadVersion(pageId, selected)
      .then(
        (v) => alive && setLoaded(v ? { id: selected, state: v.state } : null),
      )
      .catch(() => alive && setLoaded(null));
    return () => {
      alive = false;
    };
  }, [pageId, selected, reloadKey]);

  if (versions.length === 0) {
    return (
      <p className={styles.note} data-ui="HistoryView.empty">
        {t("empty")}
      </p>
    );
  }

  const current = versions.find((v) => v.id === selected) ?? null;
  const timeOf = (id: string | null) => {
    const v = versions.find((x) => x.id === id);
    return v ? dateTimeFormat.format(new Date(v.createdAt)) : null;
  };

  return (
    <>
      {canRestore && (
        <div className={historyStyles.tools}>
          <MaskPanel
            pageId={pageId}
            onDone={() => {
              setLoaded(undefined);
              setReloadKey((n) => n + 1);
              router.refresh();
            }}
          />
        </div>
      )}
      <div className={historyStyles.layout} data-ui="HistoryView">
        <ol className={historyStyles.list} data-ui="HistoryView.list">
          {versions.map((v, i) => {
            const label = v.kind === "AUTO" ? null : t(`kinds.${v.kind}`);
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className={
                    v.id === selected
                      ? historyStyles.itemCurrent
                      : historyStyles.item
                  }
                  onClick={() => {
                    setLoaded(undefined);
                    setSelected(v.id);
                  }}
                  aria-current={v.id === selected ? "true" : undefined}
                  data-ui="HistoryView.version"
                  data-id={v.id}
                >
                  <span className={historyStyles.time}>
                    {dateTimeFormat.format(new Date(v.createdAt))}
                    {i === 0 && (
                      <span className={historyStyles.badge}>{t("latest")}</span>
                    )}
                    {label && (
                      <span className={historyStyles.badge}>{label}</span>
                    )}
                    {v.masked && (
                      <span className={historyStyles.badgeMasked}>
                        {t("masked")}
                      </span>
                    )}
                  </span>
                  <span className={historyStyles.editors}>
                    {v.kind === "RESTORED" && timeOf(v.restoredFromId)
                      ? t("restoredFrom", { time: timeOf(v.restoredFromId)!, editors: v.editors.join(listSeparator) })
                      : v.editors.length > 0
                        ? v.editors.join(listSeparator)
                        : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className={historyStyles.preview} data-ui="HistoryView.preview">
          {current && (
            <div className={historyStyles.previewHeader}>
              <span className={styles.note}>
                {dateTimeFormat.format(new Date(current.createdAt))}
                {t("readOnlyVersion")}
              </span>
              {canRestore && current.masked && (
                <span className={styles.note} data-ui="HistoryView.maskedNote">
                  {t("maskedCannotRestore")}
                </span>
              )}
              {canRestore &&
                !current.masked &&
                current.id !== versions[0].id && (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={restoring}
                    data-ui="HistoryView.restoreButton"
                    onClick={async () => {
                      const when = dateTimeFormat.format(
                        new Date(current.createdAt),
                      );
                      if (
                        !(await showConfirm(
                          t("restoreConfirm", { when }),
                          { title: t("restoreTitle"), confirmLabel: t("restoreLabel") },
                        ))
                      )
                        return;
                      startRestore(async () => {
                        const result = await restorePageVersion(
                          pageId,
                          current.id,
                        );
                        if (result.error) {
                          await showAlert(result.error, { title: t("cannotRestore") });
                          return;
                        }
                        router.push(`/pages/${pageId}`);
                      });
                    }}
                  >
                    {restoring ? t("restoring") : t("restoreLabel")}
                  </button>
                )}
            </div>
          )}
          {loaded === undefined ? (
            <p className={styles.note}>{t("loading")}</p>
          ) : loaded === null ? (
            <p className={styles.error}>{t("loadFailed")}</p>
          ) : (
            <VersionPreview
              key={`${loaded.id}:${reloadKey}`}
              pageId={pageId}
              state={loaded.state}
            />
          )}
        </div>
      </div>
    </>
  );
}
