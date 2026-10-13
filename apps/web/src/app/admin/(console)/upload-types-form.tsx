"use client";

import { useActionState, useRef, useState } from "react";
import { MAX_ALLOWED_EXTENSIONS, RECOMMENDED_EXTENSIONS, parseExtensions } from "@/lib/upload-types";
import styles from "@/styles/ui.module.css";
import { type UploadTypesState, saveUploadTypes } from "./actions";

// Characters that end the extension being typed and turn it into a tag.
const SEPARATORS = /[\s,、，]/;

export function UploadTypesForm({ current }: { current: string[] }) {
  const [state, formAction, pending] = useActionState(saveUploadTypes, {} as UploadTypesState);
  const [tags, setTags] = useState(current);
  // What's being typed and isn't a tag yet.
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  // Hides the last save's message once the list is edited again.
  const [dirty, setDirty] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Turns `value` into tags. Returns false (and keeps it in the field) if it
  // isn't usable as extensions.
  const commit = (value: string): boolean => {
    const parsed = parseExtensions(value);
    if ("invalid" in parsed) {
      setInputError(`拡張子として使えません：${parsed.invalid.join("、")}（英数字と - _ + で、16文字まで）`);
      return false;
    }
    const next = [...tags, ...parsed.extensions.filter((extension) => !tags.includes(extension))];
    if (next.length > MAX_ALLOWED_EXTENSIONS) {
      setInputError(`拡張子は ${MAX_ALLOWED_EXTENSIONS} 個までです。`);
      return false;
    }
    setTags(next);
    setText("");
    setInputError(null);
    setDirty(true);
    return true;
  };

  const remove = (extension: string) => {
    setTags(tags.filter((tag) => tag !== extension));
    setDirty(true);
    input.current?.focus();
  };

  const message = inputError ?? (dirty ? "" : (state.error ?? (state.saved ? "保存しました。" : "")));

  return (
    <form
      data-ui="UploadTypesForm"
      action={(formData) => {
        setDirty(false);
        formAction(formData);
      }}
      className={styles.form}
    >
      {/* What's still in the field is sent too, so the server reports it if it's invalid. */}
      <input type="hidden" name="extensions" value={[...tags, text].join(" ")} />
      <div>
        <label htmlFor="upload-types-input">追加できる拡張子</label>
        {/* Clicking the box's empty space focuses the field, as in a text input. */}
        <div
          className={styles.tagField}
          onClick={(e) => {
            if (e.target === e.currentTarget) input.current?.focus();
          }}
        >
          {tags.map((extension) => (
            <span key={extension} className={styles.tag} data-ui="UploadTypesForm.extensionItem" data-id={extension}>
              .{extension}
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`.${extension} を削除`}
                data-ui="UploadTypesForm.removeButton"
                data-id={extension}
                onClick={() => remove(extension)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={input}
            id="upload-types-input"
            type="text"
            data-ui="UploadTypesForm.extensionInput"
            className={styles.tagInput}
            value={text}
            placeholder={tags.length === 0 ? "pdf, png, docx …（空のままなら制限なし）" : ""}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-describedby="upload-types-hint"
            onChange={(e) => {
              const value = e.target.value;
              // A separator typed or pasted: everything before the last one
              // becomes tags.
              if (SEPARATORS.test(value)) {
                // If it can't be used, it stays in the field with the reason.
                if (!commit(value)) setText(value);
                return;
              }
              setText(value);
              setInputError(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && text.trim() !== "") {
                // Enter finishes the extension; a second Enter saves.
                e.preventDefault();
                commit(text);
              } else if (e.key === "Backspace" && text === "" && tags.length > 0) {
                remove(tags[tags.length - 1]);
              }
            }}
            onBlur={() => {
              if (text.trim() !== "") commit(text);
            }}
          />
        </div>
        <p id="upload-types-hint" className={styles.note} style={{ marginTop: 4 }}>
          拡張子を入力してカンマ（または空白・Enter）で確定します。1つもないときは、すべての種類を追加できます。
        </p>
      </div>
      <p
        data-ui="UploadTypesForm.status"
        aria-live="polite"
        className={inputError || state.error ? styles.error : styles.success}
      >
        {message}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          data-ui="UploadTypesForm.recommendedButton"
          className={styles.buttonSecondary}
          onClick={() => {
            setTags([...RECOMMENDED_EXTENSIONS]);
            setText("");
            setInputError(null);
            setDirty(true);
          }}
        >
          デフォルトに戻す
        </button>
        <button data-ui="UploadTypesForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? "保存しています…" : "保存"}
        </button>
      </div>
    </form>
  );
}
