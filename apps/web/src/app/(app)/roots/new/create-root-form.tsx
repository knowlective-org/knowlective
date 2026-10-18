"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { type CreateRootState, createRoot } from "./actions";

export function CreateRootForm({ groups }: { groups: { id: string; name: string; isMember: boolean }[] }) {
  const [state, formAction, pending] = useActionState(createRoot, {} as CreateRootState);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupNameEdited, setGroupNameEdited] = useState(false);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const selected = groups.find((g) => g.id === groupId);
  const t = useTranslations("newRoot");

  return (
    <form action={formAction} className={styles.form} data-ui="CreateRootForm">
      <label>
        {t("name")}
        <input
          type="text"
          name="title"
          data-ui="CreateRootForm.titleInput"
          required
          maxLength={200}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            // Suggest a group name until the user types their own.
            if (!groupNameEdited) setGroupName(e.target.value.trim() ? t("newGroupSuggestion", { name: e.target.value.trim() }) : "");
          }}
          className={styles.field}
        />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend style={{ marginBottom: 6 }}>{t("managerGroup")}</legend>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="radio" name="groupMode" value="new" checked={mode === "new"} onChange={() => setMode("new")} data-ui="CreateRootForm.newGroupRadio" />
          {t("newGroup")}
        </label>
        {mode === "new" && (
          <input
            type="text"
            name="newGroupName"
            data-ui="CreateRootForm.newGroupNameInput"
            required
            maxLength={100}
            value={groupName}
            onChange={(e) => {
              setGroupName(e.target.value);
              setGroupNameEdited(true);
            }}
            placeholder={t("newGroupPlaceholder")}
            aria-label={t("newGroupLabel")}
            className={styles.field}
          />
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="radio"
            name="groupMode"
            value="existing"
            data-ui="CreateRootForm.existingGroupRadio"
            checked={mode === "existing"}
            disabled={groups.length === 0}
            onChange={() => setMode("existing")}
          />
          {t("existingGroup")}{groups.length === 0 && t("noGroups")}
        </label>
        {mode === "existing" && (
          <>
            <select
              name="groupId"
              data-ui="CreateRootForm.groupSelect"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              aria-label={t("existingGroupLabel")}
              className={styles.field}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isMember ? "" : t("notMember")}
                </option>
              ))}
            </select>
            {selected && !selected.isMember && (
              <p className={styles.error} data-ui="CreateRootForm.notMemberWarning">
                {t("notMemberWarning")}
              </p>
            )}
          </>
        )}
      </fieldset>

      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="shareWithAll" data-ui="CreateRootForm.shareWithAllCheckbox" />
        {t("shareWithAll")}
      </label>

      <p aria-live="polite" className={styles.error} data-ui="CreateRootForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="CreateRootForm.submitButton">
        {pending ? t("creating") : t("create")}
      </button>
    </form>
  );
}
