"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MAX_MASKED_TEXT_LENGTH } from "@/lib/page-property-types";
import { SecretKeyring, secretTextSupported } from "@/lib/secret-text";
import { showAlert, showPassphrase } from "@/components/dialog";
import styles from "./child-blocks.module.css";

// Masked columns of child page tables (type MASKED): each value is text
// sealed with the column's passphrase in the browser (lib/secret-text.ts),
// so the server and its database only ever have the sealed string, like the
// masked block. A viewer shows a column by typing its passphrase (the first
// time a value is put in it, they choose one); it stays in this page's
// memory until hidden again or the page is closed, and is never sent.
// Changing a value seals it again with the same passphrase.

type Masks = {
  keyring(columnId: string): SecretKeyring | undefined;
  set(columnId: string, keyring: SecretKeyring | null): void;
  // The column's sealed values (to check a passphrase against).
  values(columnId: string): string[];
  // No header to hide the column from (a page's properties): each cell has its own button.
  inlineHide: boolean;
};

const MaskContext = createContext<Masks | null>(null);

export function MaskProvider({
  values,
  inlineHide = false,
  children,
}: {
  values: (columnId: string) => string[];
  inlineHide?: boolean;
  children: ReactNode;
}) {
  const [rings, setRings] = useState<Record<string, SecretKeyring>>({});
  const masks = useMemo<Masks>(
    () => ({
      keyring: (id) => rings[id],
      set: (id, ring) =>
        setRings((current) => {
          const next = { ...current };
          if (ring) next[id] = ring;
          else delete next[id];
          return next;
        }),
      values,
      inlineHide,
    }),
    [rings, values, inlineHide],
  );
  return <MaskContext.Provider value={masks}>{children}</MaskContext.Provider>;
}

function useMasks(): Masks {
  const masks = useContext(MaskContext);
  if (!masks) throw new Error("a masked cell outside MaskProvider");
  return masks;
}

// Asks for the column's passphrase (a new one, typed twice, while the
// column has no values) and checks it against a value, in the dialog: the
// key takes a moment to derive, and a wrong one is typed again there. Clicks
// while the dialog is open are ignored (one dialog, not one per click).
const asking = new Set<string>();

function useShowColumn(columnId: string) {
  const t = useTranslations("editor.childTable.masked");
  const masks = useMasks();
  return async () => {
    if (!secretTextSupported()) return void (await showAlert(t("unsupported")));
    if (asking.has(columnId)) return;
    asking.add(columnId);
    try {
      const sample = masks.values(columnId).find(Boolean);
      let ring: SecretKeyring | null = null;
      const passphrase = sample
        ? await showPassphrase(t("enter"), {
            title: t("enterTitle"),
            confirmLabel: t("open"),
            check: async (typed) => {
              const candidate = new SecretKeyring(typed);
              try {
                await candidate.open(sample);
              } catch {
                // WrongPassphraseError, or a damaged value: either way not this passphrase's.
                return t("wrong");
              }
              ring = candidate;
              return null;
            },
          })
        : await showPassphrase(t("choose"), { title: t("chooseTitle"), repeat: true });
      if (!passphrase) return;
      masks.set(columnId, ring ?? new SecretKeyring(passphrase));
    } finally {
      asking.delete(columnId);
    }
  };
}

// "Show" / "Hide" in the column's header.
export function MaskedColumnToggle({ columnId }: { columnId: string }) {
  const t = useTranslations("editor.childTable.masked");
  const masks = useMasks();
  const show = useShowColumn(columnId);
  const shown = !!masks.keyring(columnId);
  return (
    <button
      type="button"
      className={styles.maskToggle}
      onClick={() => (shown ? masks.set(columnId, null) : void show())}
      title={shown ? undefined : t("openTitle")}
      data-ui="MaskedColumnToggle"
      data-id={columnId}
      data-shown={shown || undefined}
    >
      <span aria-hidden>{shown ? "🔓" : "🔒"}</span> {shown ? t("hide") : t("open")}
    </button>
  );
}

// `editor`: the text cell to change the opened text with (the table's).
export function MaskedCell({
  columnId,
  value,
  editable,
  onSave,
  editor,
}: {
  columnId: string;
  value: string;
  editable: boolean;
  onSave: (sealed: string) => void;
  editor: (text: string, onSave: (text: string) => void) => ReactNode;
}) {
  const t = useTranslations("editor.childTable.masked");
  const masks = useMasks();
  const ring = masks.keyring(columnId);
  const show = useShowColumn(columnId);
  // The opened text of `from` (null: another passphrase locked it).
  const [opened, setOpened] = useState<{ ring: SecretKeyring; from: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!ring || !value) return;
    let alive = true;
    ring.open(value).then(
      (text) => alive && setOpened({ ring, from: value, text }),
      () => alive && setOpened({ ring, from: value, text: null }),
    );
    return () => {
      alive = false;
    };
  }, [ring, value]);

  if (!ring) {
    if (!value && !editable) return null;
    return (
      <button
        type="button"
        className={styles.maskedValue}
        onClick={() => void show()}
        title={t("openTitle")}
        data-ui="MaskedCell.showButton"
      >
        <span aria-hidden>🔒</span>
        {value && <span aria-label={t("hidden")}> ••••••</span>}
      </button>
    );
  }
  const current = !value ? "" : opened?.ring === ring && opened.from === value ? opened.text : undefined;
  if (current === undefined) return <span className={styles.muted}>…</span>;
  const hide = masks.inlineHide && (
    <button type="button" className={styles.maskToggle} onClick={() => masks.set(columnId, null)} data-ui="MaskedCell.hideButton">
      {t("hide")}
    </button>
  );
  if (current === null) {
    return (
      <span className={styles.muted} data-ui="MaskedCell.otherPassphraseStatus">
        <span aria-hidden>⚠ 🔒</span> {t("otherPassphrase")}
        {hide}
      </span>
    );
  }
  const save = (text: string) => {
    const next = text.trim().slice(0, MAX_MASKED_TEXT_LENGTH);
    if (!next) return onSave("");
    ring.seal(next).then(onSave, () => void showAlert(t("sealFailed")));
  };
  return (
    <span className={styles.maskedOpen} data-ui="MaskedCell">
      {editable ? editor(current, save) : <span className={styles.text}>{current}</span>}
      {hide}
    </span>
  );
}
