"use client";

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

const STEP_LABELS = { write: "書き込み", read: "読み出し", delete: "削除" } as const;

export function StorageSettingsForm({
  current,
  fileCount,
}: {
  current: StorageSettingsView | null;
  fileCount: number;
}) {
  const [state, formAction, pending] = useActionState(saveStorage, {} as StorageFormState);
  const [test, testAction, testing] = useActionState(testStorageConnection, {} as StorageTestState);
  const custom = current?.source === "custom" ? current : null;
  const [pathStyle, setPathStyle] = useState(custom?.forcePathStyle ?? true);

  return (
    <div data-ui="StorageSettingsForm" className={styles.form}>
      <p data-ui="StorageSettingsForm.currentStatus" className={styles.note}>
        {current === null
          ? "ファイル保存が設定されていません。同梱のストレージの認証情報（SEAWEEDFS_*）が .env にないため、ファイル添付は使えません。"
          : current.source === "bundled"
            ? `現在は同梱のストレージ（SeaweedFS: ${current.endpoint}、バケット「${current.bucket}」）を使っています。外部の S3 互換ストレージを使う場合は、下で設定してください。`
            : `現在は ${current.endpoint} のバケット「${current.bucket}」を使っています。`}
        {" "}保存済みのファイル: {fileCount}件
      </p>

      <form data-ui="StorageSettingsForm.settingsForm" action={formAction} className={styles.form}>
        <label>
          エンドポイント URL
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
          バケット名
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
          リージョン（任意。空欄なら自動）
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
          アクセスキー ID
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
          シークレットアクセスキー
          <input
            type="password"
            data-ui="StorageSettingsForm.secretAccessKeyInput"
            name="secretAccessKey"
            required={!custom}
            autoComplete="new-password"
            placeholder={custom ? "（保存済み。変更する場合のみ入力）" : ""}
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
          パス形式でアクセスする（MinIO・SeaweedFS などはオン、AWS はオフ）
        </label>
        <label>
          キーの接頭辞（任意。バケットをほかの用途と共用する場合）
          <input
            type="text"
            data-ui="StorageSettingsForm.keyPrefixInput"
            name="keyPrefix"
            defaultValue={custom?.keyPrefix ?? ""}
            placeholder="yosuga/"
            spellCheck={false}
            className={styles.field}
          />
        </label>

        {state.needsMigrationConfirm !== undefined && (
          <div data-ui="StorageSettingsForm.migrationConfirm" className={styles.error}>
            <p style={{ marginBottom: 8 }}>
              保存先が変わります。保存済みのファイル（{state.needsMigrationConfirm}件）は自動では移行されません。
              今の保存先のオブジェクト（キーの接頭辞 + <code>files/</code> 以下）を新しい保存先へコピーしてから保存してください。
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input data-ui="StorageSettingsForm.confirmMigratedCheckbox" type="checkbox" name="confirmMigrated" />
              既存ファイルを新しい保存先へ移行済みです
            </label>
          </div>
        )}
        <p data-ui="StorageSettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
          {state.error ?? (state.saved ? "保存しました。「接続テスト」で確認してください。" : "")}
        </p>
        <button data-ui="StorageSettingsForm.saveButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? "保存しています…" : "保存"}
        </button>
      </form>

      <form data-ui="StorageSettingsForm.testForm" action={testAction} className={styles.form} style={{ marginTop: 8 }}>
        <p data-ui="StorageSettingsForm.testResult" aria-live="polite" className={test.result?.ok === false ? styles.error : styles.success}>
          {test.result?.ok === true &&
            (test.result.missingExisting > 0
              ? `書き込み・読み出し・削除は成功しましたが、既存ファイル ${test.result.checkedExisting}件中 ${test.result.missingExisting}件が見つかりません。移行が終わっているか確認してください。`
              : `書き込み・読み出し・削除に成功しました${test.result.checkedExisting > 0 ? `（既存ファイル ${test.result.checkedExisting}件も確認済み）` : ""}。`)}
          {test.result?.ok === false && `${STEP_LABELS[test.result.step]}に失敗しました: ${test.result.message}`}
        </p>
        <button data-ui="StorageSettingsForm.testButton" type="submit" disabled={testing || current === null} className={styles.button}>
          {testing ? "確認しています…" : "接続テスト（今の設定で）"}
        </button>
      </form>

      {custom && (
        <form
          data-ui="StorageSettingsForm.resetForm"
          action={resetStorage}
          onSubmit={(e) => {
            const msg =
              fileCount > 0
                ? `同梱のストレージに戻します。保存済みのファイル（${fileCount}件）は自動では移行されません。移行済みですか？`
                : "同梱のストレージに戻しますか？";
            confirmBeforeSubmit(e, msg, { title: "ファイル保存", confirmLabel: "同梱のストレージに戻す", danger: true });
          }}
        >
          <button data-ui="StorageSettingsForm.resetButton" type="submit" className={styles.danger}>
            同梱のストレージに戻す
          </button>
        </form>
      )}
    </div>
  );
}
