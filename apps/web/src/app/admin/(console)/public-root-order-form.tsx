"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { type PublicRootOrderState, savePublicRootOrder } from "./actions";

export type PublicRootRow = { rootId: string; label: string };

// The knowledge roots with public pages, in the order someone not logged in
// sees them: moved up and down here, saved as that order.
export function PublicRootOrderForm({ roots }: { roots: PublicRootRow[] }) {
  const [state, formAction, pending] = useActionState(savePublicRootOrder, {} as PublicRootOrderState);
  const ta = useTranslations("admin");
  const [rows, setRows] = useState(roots);
  const move = (i: number, by: -1 | 1) =>
    setRows((list) => {
      const next = [...list];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  return (
    <form data-ui="PublicRootOrderForm" action={formAction} className={styles.form}>
      <div role="list" style={{ display: "grid", gap: 4 }}>
        {rows.map((r, i) => (
          <div
            key={r.rootId}
            role="listitem"
            style={{ display: "flex", gap: 8, alignItems: "center" }}
            data-ui="PublicRootOrderForm.row"
            data-id={r.rootId}
          >
            <input type="hidden" name="rootId" value={r.rootId} />
            <span style={{ minWidth: "1.5em", textAlign: "right" }}>{i + 1}.</span>
            <span style={{ flex: 1 }}>{r.label}</span>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label={ta("publicRootOrder.up", { label: r.label })}
              data-ui="PublicRootOrderForm.upButton"
              data-id={r.rootId}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={i === rows.length - 1}
              onClick={() => move(i, 1)}
              aria-label={ta("publicRootOrder.down", { label: r.label })}
              data-ui="PublicRootOrderForm.downButton"
              data-id={r.rootId}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <p data-ui="PublicRootOrderForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="PublicRootOrderForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}
