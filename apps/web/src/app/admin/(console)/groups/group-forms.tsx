"use client";

import { useTranslations } from "next-intl";
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
  const ta = useTranslations("admin");
  return (
    <>
      <label>
        {ta("groups.name")}
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
        {ta("groups.descriptionOptional")}
        <input data-ui="GroupFields.descriptionInput" type="text" name="description" defaultValue={description ?? ""} className={styles.field} />
      </label>
    </>
  );
}

export function CreateGroupForm() {
  const [state, formAction, pending] = useActionState(createGroup, {} as GroupFormState);
  const ta = useTranslations("admin");
  return (
    <form data-ui="CreateGroupForm" action={formAction} className={styles.form}>
      <GroupFields />
      <p data-ui="CreateGroupForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="CreateGroupForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("groups.creating") : ta("groups.create")}
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
  const ta = useTranslations("admin");
  return (
    <form data-ui="EditGroupForm" action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={id} />
      <GroupFields name={name} description={description} />
      <p data-ui="EditGroupForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="EditGroupForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

export function AddMemberForm({ groupId }: { groupId: string }) {
  const [state, formAction, pending] = useActionState(addGroupMember, {} as AddMemberState);
  const ta = useTranslations("admin");
  return (
    <form data-ui="AddMemberForm" action={formAction} className={styles.form}>
      <input type="hidden" name="groupId" value={groupId} />
      <label>
        {ta("groups.memberEmail")}
        <input data-ui="AddMemberForm.emailInput" type="email" name="email" required className={styles.field} />
      </label>
      <p data-ui="AddMemberForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.added ? ta("groups.added", { email: state.added }) : "")}
      </p>
      <button data-ui="AddMemberForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("groups.adding") : ta("groups.addMember")}
      </button>
    </form>
  );
}
