"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { VERSION_KIND_LABELS, type PageVersionKind } from "@/lib/page-versions";
import styles from "@/styles/ui.module.css";
import { loadVersion, restorePageVersion } from "./actions";
import historyStyles from "./history.module.css";

// BlockNote touches `window`, so the preview never renders on the server.
const VersionPreview = dynamic(() => import("./version-preview").then((m) => m.VersionPreview), {
  ssr: false,
  loading: () => <p className={styles.note}>読み込み中…</p>,
});

export type VersionItem = {
  id: string;
  createdAt: string;
  kind: PageVersionKind;
  title: string;
  editors: string[];
  restoredFromId: string | null;
};

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

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
  const [selected, setSelected] = useState<string | null>(versions[0]?.id ?? null);
  // Loaded state of the selected version (undefined while loading).
  const [loaded, setLoaded] = useState<{ id: string; state: string } | null | undefined>(undefined);
  const [restoring, startRestore] = useTransition();

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    loadVersion(pageId, selected)
      .then((v) => alive && setLoaded(v ? { id: selected, state: v.state } : null))
      .catch(() => alive && setLoaded(null));
    return () => {
      alive = false;
    };
  }, [pageId, selected]);

  if (versions.length === 0) {
    return (
      <p className={styles.note} data-ui="HistoryView.empty">
        まだ保存された版はありません。ページを編集すると、版が保存されていきます。
      </p>
    );
  }

  const current = versions.find((v) => v.id === selected) ?? null;
  const timeOf = (id: string | null) => {
    const v = versions.find((x) => x.id === id);
    return v ? dateTimeFormat.format(new Date(v.createdAt)) : null;
  };

  return (
    <div className={historyStyles.layout} data-ui="HistoryView">
      <ol className={historyStyles.list} data-ui="HistoryView.list">
        {versions.map((v, i) => {
          const label = VERSION_KIND_LABELS[v.kind];
          return (
            <li key={v.id}>
              <button
                type="button"
                className={v.id === selected ? historyStyles.itemCurrent : historyStyles.item}
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
                  {i === 0 && <span className={historyStyles.badge}>最新</span>}
                  {label && <span className={historyStyles.badge}>{label}</span>}
                </span>
                <span className={historyStyles.editors}>
                  {v.kind === "RESTORED" && timeOf(v.restoredFromId)
                    ? `${timeOf(v.restoredFromId)} の版に戻した（${v.editors.join("、")}）`
                    : v.editors.length > 0
                      ? v.editors.join("、")
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
            <span className={styles.note}>{dateTimeFormat.format(new Date(current.createdAt))} の版（読み取り専用）</span>
            {canRestore && current.id !== versions[0].id && (
              <button
                type="button"
                className={styles.button}
                disabled={restoring}
                data-ui="HistoryView.restoreButton"
                onClick={() => {
                  const when = dateTimeFormat.format(new Date(current.createdAt));
                  if (!window.confirm(`ページの内容を ${when} の版に戻しますか？\n今の内容も版として残るので、あとから戻せます。`)) return;
                  startRestore(async () => {
                    const result = await restorePageVersion(pageId, current.id);
                    if (result.error) {
                      window.alert(result.error);
                      return;
                    }
                    router.push(`/pages/${pageId}`);
                  });
                }}
              >
                {restoring ? "戻しています…" : "この版に戻す"}
              </button>
            )}
          </div>
        )}
        {loaded === undefined ? (
          <p className={styles.note}>読み込み中…</p>
        ) : loaded === null ? (
          <p className={styles.error}>この版を読み込めませんでした。</p>
        ) : (
          <VersionPreview key={loaded.id} pageId={pageId} state={loaded.state} />
        )}
      </div>
    </div>
  );
}
