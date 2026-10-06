"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import {
  type AddMemberState,
  type GroupFormState,
  addGroupMember,
  createGroup,
  updateGroup,
} from "./actions";

function GroupFields({ name, description }: { name?: string; description?: string | null }) {
  return (
    <>
      <label>
        グループ名
        <input
          type="text"
          data-ui="GroupFields.nameInput"
          name="name"
          required
          maxLength={100}
          defaultValue={name}
          className={styles.field}
        />
      </label>
      <label>
        説明（任意）
        <input data-ui="GroupFields.descriptionInput" type="text" name="description" defaultValue={description ?? ""} className={styles.field} />
      </label>
    </>
  );
}

export function CreateGroupForm() {
  const [state, formAction, pending] = useActionState(createGroup, {} as GroupFormState);
  return (
    <form data-ui="CreateGroupForm" action={formAction} className={styles.form}>
      <GroupFields />
      <p data-ui="CreateGroupForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="CreateGroupForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "作成しています…" : "グループを作成"}
      </button>
    </form>
  );
}

export function EditGroupForm({
  id,
  name,
  description,
}: {
  id: string;
  name: string;
  description: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateGroup, {} as GroupFormState);
  return (
    <form data-ui="EditGroupForm" action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={id} />
      <GroupFields name={name} description={description} />
      <p data-ui="EditGroupForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="EditGroupForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}

export function AddMemberForm({ groupId }: { groupId: string }) {
  const [state, formAction, pending] = useActionState(addGroupMember, {} as AddMemberState);
  return (
    <form data-ui="AddMemberForm" action={formAction} className={styles.form}>
      <input type="hidden" name="groupId" value={groupId} />
      <label>
        追加するユーザーのメールアドレス
        <input data-ui="AddMemberForm.emailInput" type="email" name="email" required className={styles.field} />
      </label>
      <p data-ui="AddMemberForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.added ? `${state.added} を追加しました。` : "")}
      </p>
      <button data-ui="AddMemberForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "追加しています…" : "メンバーに追加"}
      </button>
    </form>
  );
}
