"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { type NetworkAccessState, saveNetworkAccess } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

type Others = { access: boolean; read: boolean; write: boolean; download: boolean; upload: boolean };

// Networks with full access to the site, and what other networks may do.
export function NetworkAccessForm({
  fullAccess,
  others,
  clientIp,
  clientFull,
}: {
  fullAccess: string[];
  others: Others;
  clientIp: string;
  // Whether the admin's own address is in the list (or no list is set).
  clientFull: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveNetworkAccess, {} as NetworkAccessState);
  const ta = useTranslations("admin");
  const [flags, setFlags] = useState<Others>(others);
  // Each needs the one before it (the server enforces it too).
  const enabled: Record<keyof Others, boolean> = {
    access: true,
    read: flags.access,
    write: flags.access && flags.read,
    download: flags.access,
    upload: flags.access && flags.read,
  };

  return (
    // Submitted by hand (see LinkPreviewSettingsForm): an action form would
    // reset the checkboxes.
    <form
      data-ui="NetworkAccessForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label>
        {ta("network.fullAccess")}
        <textarea
          data-ui="NetworkAccessForm.fullAccessInput"
          name="fullAccess"
          rows={5}
          defaultValue={fullAccess.join("\n")}
          placeholder={ta("ipAllowlist.placeholder", { ip: clientIp })}
          spellCheck={false}
          className={styles.code}
          style={{ letterSpacing: "normal" }}
        />
        <span className={styles.note}>{ta("network.fullAccessNote")}</span>
      </label>
      <p className={styles.note} data-ui="NetworkAccessForm.clientStatus">
        {ta.rich(clientFull ? "network.youFull" : "network.youLimited", {
          ip: clientIp,
          code: (chunks) => <code>{chunks}</code>,
        })}
      </p>
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 8 }}>
        <legend style={{ marginBottom: 8 }}>{ta("network.others")}</legend>
        {(["access", "read", "write", "download", "upload"] as const).map((key) => (
          <label key={key} style={{ ...checkRow, paddingLeft: key === "access" ? 0 : 24 }}>
            <input
              type="checkbox"
              name={key}
              checked={flags[key] && enabled[key]}
              disabled={!enabled[key]}
              onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
              data-ui="NetworkAccessForm.flagCheckbox"
              data-id={key}
            />
            <span>
              {ta(`network.flags.${key}`)}
              <span className={styles.note} style={{ display: "block" }}>
                {ta(`network.flagNotes.${key}`)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <StatusRow
        message={state.error ?? (state.saved ? ta("common.saved") : "")}
        className={state.error ? styles.error : styles.success}
        dataUi="NetworkAccessForm.status"
      >
        <button data-ui="NetworkAccessForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("common.saving") : ta("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}
