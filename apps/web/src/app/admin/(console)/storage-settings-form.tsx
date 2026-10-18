"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import type { StorageSettingsView } from "@/lib/storage";
import styles from "@/styles/ui.module.css";
import {
  type StorageFormState,
  type StorageTestState,
  resetStorage,
  saveStorage,
  testStorageConnection,
} from "./actions";
import { confirmBeforeSubmit } from "@/components/dialog";

export function StorageSettingsForm({
  current,
  fileCount,
}: {
  current: StorageSettingsView | null;
  fileCount: number;
}) {
  const [state, formAction, pending] = useActionState(saveStorage, {} as StorageFormState);
  const ta = useTranslations("admin");
  const [test, testAction, testing] = useActionState(testStorageConnection, {} as StorageTestState);
  const custom = current?.source === "custom" ? current : null;
  const [pathStyle, setPathStyle] = useState(custom?.forcePathStyle ?? true);

  return (
    <div data-ui="StorageSettingsForm" className={styles.form}>
      <p data-ui="StorageSettingsForm.currentStatus" className={styles.note}>
        {current === null
          ? ta("storage.notConfigured")
          : current.source === "bundled"
            ? ta("storage.bundled", { endpoint: current.endpoint, bucket: current.bucket })
            : ta("storage.custom", { endpoint: current.endpoint, bucket: current.bucket })}
        {ta("storage.fileCount", { count: fileCount })}
      </p>

      <form data-ui="StorageSettingsForm.settingsForm" action={formAction} className={styles.form}>
        <label>
          {ta("storage.endpoint")}
          <input
            type="url"
            data-ui="StorageSettingsForm.endpointInput"
            name="endpoint"
            required
            defaultValue={custom?.endpoint}
            placeholder="https://s3.ap-northeast-1.amazonaws.com"
            spellCheck={false}
            className={styles.field}
          />
        </label>
        <label>
          {ta("storage.bucket")}
          <input
            type="text"
            data-ui="StorageSettingsForm.bucketInput"
            name="bucket"
            required
            defaultValue={custom?.bucket}
            spellCheck={false}
            className={styles.field}
          />
        </label>
        <label>
          {ta("storage.region")}
          <input
            type="text"
            data-ui="StorageSettingsForm.regionInput"
            name="region"
            defaultValue={custom?.region ?? ""}
            placeholder="ap-northeast-1"
            spellCheck={false}
            className={styles.field}
          />
        </label>
        <label>
          {ta("storage.accessKey")}
          <input
            type="text"
            data-ui="StorageSettingsForm.accessKeyIdInput"
            name="accessKeyId"
            required
            defaultValue={custom?.accessKeyId}
            autoComplete="off"
            spellCheck={false}
            className={styles.field}
          />
        </label>
        <label>
          {ta("storage.secretKey")}
          <input
            type="password"
            data-ui="StorageSettingsForm.secretAccessKeyInput"
            name="secretAccessKey"
            required={!custom}
            autoComplete="new-password"
            placeholder={custom ? ta("common.inputHint") : ""}
            className={styles.field}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            data-ui="StorageSettingsForm.forcePathStyleCheckbox"
            name="forcePathStyle"
            checked={pathStyle}
            onChange={(e) => setPathStyle(e.target.checked)}
          />
          {ta("storage.pathStyle")}
        </label>
        <label>
          {ta("storage.prefix")}
          <input
            type="text"
            data-ui="StorageSettingsForm.keyPrefixInput"
            name="keyPrefix"
            defaultValue={custom?.keyPrefix ?? ""}
            placeholder="knowlective/"
            spellCheck={false}
            className={styles.field}
          />
        </label>

        {state.needsMigrationConfirm !== undefined && (
          <div data-ui="StorageSettingsForm.migrationConfirm" className={styles.error}>
            <p style={{ marginBottom: 8 }}>
              {ta("storage.migrationWarning", { count: state.needsMigrationConfirm })}{" "}
              {ta.rich("storage.migrationHow", { code: (chunks) => <code>{chunks}</code> })}
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input data-ui="StorageSettingsForm.confirmMigratedCheckbox" type="checkbox" name="confirmMigrated" />
              {ta("storage.migrated")}
            </label>
          </div>
        )}
        <p data-ui="StorageSettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
          {state.error ?? (state.saved ? ta("storage.saved") : "")}
        </p>
        <button data-ui="StorageSettingsForm.saveButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("common.saving") : ta("common.save")}
        </button>
      </form>

      <form data-ui="StorageSettingsForm.testForm" action={testAction} className={styles.form} style={{ marginTop: 8 }}>
        <p data-ui="StorageSettingsForm.testResult" aria-live="polite" className={test.result?.ok === false ? styles.error : styles.success}>
          {test.result?.ok === true &&
            (test.result.missingExisting > 0
              ? ta("storage.testMissing", { checked: test.result.checkedExisting, missing: test.result.missingExisting })
              : ta("storage.testOk", { checked: test.result.checkedExisting }))}
          {test.result?.ok === false &&
            ta("storage.testFailed", { step: ta(`storage.steps.${test.result.step}`), message: test.result.message })}
        </p>
        <button data-ui="StorageSettingsForm.testButton" type="submit" disabled={testing || current === null} className={styles.button}>
          {testing ? ta("storage.testing") : ta("storage.test")}
        </button>
      </form>

      {custom && (
        <form
          data-ui="StorageSettingsForm.resetForm"
          action={resetStorage}
          onSubmit={(e) => {
            const msg =
              fileCount > 0
                ? ta("storage.revertConfirmFiles", { count: fileCount })
                : ta("storage.revertConfirm");
            confirmBeforeSubmit(e, msg, { title: ta("storage.revertTitle"), confirmLabel: ta("storage.revert"), danger: true });
          }}
        >
          <button data-ui="StorageSettingsForm.resetButton" type="submit" className={styles.danger}>
            {ta("storage.revert")}
          </button>
        </form>
      )}
    </div>
  );
}
