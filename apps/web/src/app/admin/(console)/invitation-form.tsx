"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { issueInvitation, type InvitationState } from "./actions";

const initialState: InvitationState = {};

export function InvitationForm({
  groups,
  ttlDays,
  mailConfigured,
  siteRoles,
}: {
  // Groups the invitee can be added to (page access comes only from groups).
  groups: { id: string; name: string; description: string | null }[];
  ttlDays: number;
  mailConfigured: boolean;
  // Roles the signed-in admin may hand out, with labels.
  siteRoles: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(issueInvitation, initialState);
  const ta = useTranslations("admin");
  const [copied, setCopied] = useState(false);
  const [sendEmail, setSendEmail] = useState(mailConfigured);

  return (
    <div data-ui="InvitationForm" className={styles.form}>
      <form data-ui="InvitationForm.form" action={formAction} className={styles.form} onSubmit={() => setCopied(false)}>
        <label>
          {ta("invitation.role")}
          <select data-ui="InvitationForm.siteRoleSelect" name="siteRole" defaultValue="USER" className={styles.field}>
            {siteRoles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>{ta("invitation.groups")}</legend>
          {groups.length === 0 ? (
            <p className={styles.note}>{ta("invitation.noGroups")}</p>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {groups.map((g) => (
                <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input data-ui="InvitationForm.groupCheckbox" data-id={g.id} type="checkbox" name="groupIds" value={g.id} />
                  {g.name}
                  {g.description && <span className={styles.note}>— {g.description}</span>}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <label>
          {ta("invitation.email", { required: String(sendEmail) })}
          <input data-ui="InvitationForm.emailInput" type="email" name="email" required={sendEmail} className={styles.field} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            data-ui="InvitationForm.sendEmailCheckbox"
            name="sendEmail"
            checked={sendEmail}
            disabled={!mailConfigured}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          {ta("invitation.sendEmail")}
        </label>
        {!mailConfigured && (
          <p className={styles.note}>
            {ta("invitation.mailNotConfigured")}
          </p>
        )}
        <p data-ui="InvitationForm.error" aria-live="polite" className={styles.error}>
          {state.error}
        </p>
        <button data-ui="InvitationForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("common.issuing") : sendEmail ? ta("invitation.issueAndSend") : ta("invitation.issue")}
        </button>
      </form>

      {state.link && (
        <div>
          {state.mailSentTo && (
            <p data-ui="InvitationForm.mailSentMessage" className={styles.success}>{ta("invitation.sent", { email: state.mailSentTo })}</p>
          )}
          {state.mailError && (
            <p data-ui="InvitationForm.mailError" className={styles.error}>
              {ta("invitation.sendFailed", { error: state.mailError })}
            </p>
          )}
          <p className={styles.note}>
            {ta("invitation.linkNote", { days: ttlDays })}
          </p>
          <p data-ui="InvitationForm.inviteLink" className={styles.secret}>{state.link}</p>
          <button
            data-ui="InvitationForm.copyButton"
            type="button"
            className={styles.buttonSecondary}
            style={{ display: "block", marginTop: 8, marginLeft: "auto" }}
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? ta("common.copied") : ta("common.copy")}
          </button>
        </div>
      )}
    </div>
  );
}
