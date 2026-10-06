"use client";

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

  return (
    <form action={formAction} className={styles.form} data-ui="CreateRootForm">
      <label>
        ナレッジルートの名前
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
            if (!groupNameEdited) setGroupName(e.target.value.trim() ? `${e.target.value.trim()} 管理` : "");
          }}
          className={styles.field}
        />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend style={{ marginBottom: 6 }}>「管理」の権限を付けるグループ</legend>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="radio" name="groupMode" value="new" checked={mode === "new"} onChange={() => setMode("new")} data-ui="CreateRootForm.newGroupRadio" />
          新しいグループを作る（あなたもメンバーになります）
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
            placeholder="例: 営業部 管理"
            aria-label="新しいグループの名前"
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
          既存のグループを選ぶ{groups.length === 0 && "（選べるグループがありません）"}
        </label>
        {mode === "existing" && (
          <>
            <select
              name="groupId"
              data-ui="CreateRootForm.groupSelect"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              aria-label="既存のグループ"
              className={styles.field}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isMember ? "" : "（あなたは未参加）"}
                </option>
              ))}
            </select>
            {selected && !selected.isMember && (
              <p className={styles.error} data-ui="CreateRootForm.notMemberWarning">
                あなたはこのグループのメンバーではないため、作成後にこのナレッジルートを開けません。
              </p>
            )}
          </>
        )}
      </fieldset>

      <p aria-live="polite" className={styles.error} data-ui="CreateRootForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="CreateRootForm.submitButton">
        {pending ? "作成しています…" : "作成する"}
      </button>
    </form>
  );
}
