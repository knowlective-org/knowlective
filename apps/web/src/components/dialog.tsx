"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { normalizeConfirmCode, randomConfirmCode } from "@/lib/confirm-code";
import ui from "@/styles/ui.module.css";
import styles from "./dialog.module.css";

// The app's replacements for window.alert / confirm / prompt: the same modal
// as the other dialogs (dialog.module.css), callable from anywhere —
// components, event handlers, plain async functions:
//
//   if (!(await showConfirm("Delete it?", { danger: true, confirmLabel: "Delete" }))) return;
//
// <DialogHost /> (in the root layout) shows the requests one at a time.

type Base = { id: number; title?: string; message: string };
type Request =
  | (Base & { kind: "alert"; resolve: () => void })
  | (Base & {
      kind: "confirm";
      confirmLabel: string;
      danger: boolean;
      // Shown for the person to type back before the action can be confirmed.
      code?: string;
      resolve: (ok: boolean) => void;
    })
  | (Base & { kind: "copy"; value: string; resolve: () => void })
  | (Base & { kind: "choice"; choices: Choice[]; resolve: (value: string | null) => void });

type Choice = { value: string; label: string };

type NewRequest = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

// Requests made before <DialogHost /> has mounted wait here.
let host: ((request: NewRequest) => void) | null = null;
const pending: NewRequest[] = [];
const enqueue = (request: NewRequest) => {
  if (host) host(request);
  else pending.push(request);
};
const register = (fn: typeof host) => {
  host = fn;
  if (fn) pending.splice(0).forEach(fn);
};

// A message with an OK button (window.alert).
export function showAlert(message: string, options: { title?: string } = {}): Promise<void> {
  return new Promise((resolve) => enqueue({ kind: "alert", message, title: options.title, resolve }));
}

// OK / cancel (window.confirm). `danger` for something hard to undo: the
// button turns red and the cancel button gets the initial focus.
export function showConfirm(
  message: string,
  options: { title?: string; confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) =>
    enqueue({
      kind: "confirm",
      message,
      title: options.title,
      confirmLabel: options.confirmLabel ?? "OK",
      danger: options.danger ?? false,
      resolve,
    }),
  );
}

// OK / cancel, where OK only works once a short code shown in the dialog has
// been typed back: for actions that should never happen by a stray click.
// The code is a confirmation, not a secret (lib/confirm-code.ts).
export function showTypedConfirm(
  message: string,
  options: { title?: string; confirmLabel?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) =>
    enqueue({
      kind: "confirm",
      message,
      title: options.title,
      confirmLabel: options.confirmLabel ?? "OK",
      danger: false,
      code: randomConfirmCode(),
      resolve,
    }),
  );
}

// A selected, read-only text to copy: a click on it (or the copy button)
// puts it on the clipboard, and it can be copied by hand too (for when the clipboard API
// isn't available, e.g. plain-http intranet installs).
export function showCopyText(message: string, value: string, options: { title?: string } = {}): Promise<void> {
  return new Promise((resolve) => enqueue({ kind: "copy", message, value, title: options.title, resolve }));
}

// One of several ways to go on, or cancel (null). The last choice is the
// suggested one: it's the filled button and gets the initial focus.
export function showChoice<T extends string>(
  message: string,
  choices: { value: T; label: string }[],
  options: { title?: string } = {},
): Promise<T | null> {
  return new Promise((resolve) =>
    enqueue({
      kind: "choice",
      message,
      title: options.title,
      choices,
      resolve: resolve as (value: string | null) => void,
    }),
  );
}

// For <form onSubmit>: asks first, and submits only if confirmed. The form
// must stay mounted while the dialog is open.
export function confirmBeforeSubmit(
  e: FormEvent<HTMLFormElement>,
  message: string,
  options?: Parameters<typeof showConfirm>[1],
): void {
  const form = e.currentTarget;
  if (form.dataset.confirmed) {
    delete form.dataset.confirmed;
    return;
  }
  e.preventDefault();
  const submitter = (e.nativeEvent as SubmitEvent).submitter;
  void showConfirm(message, options).then((ok) => {
    if (!ok || !form.isConnected) return;
    form.dataset.confirmed = "1";
    form.requestSubmit(submitter instanceof HTMLElement && submitter.closest("form") === form ? submitter : undefined);
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    register((request) => setQueue((q) => [...q, { ...request, id: nextId.current++ } as Request]));
    return () => register(null);
  }, []);

  const current = queue[0];
  if (!current) return null;
  return (
    <AppDialog
      key={current.id}
      request={current}
      onDone={() => setQueue((q) => q.filter((r) => r.id !== current.id))}
    />
  );
}

function AppDialog({ request, onDone }: { request: Request; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const done = useRef(false);
  // For a confirmation with a code: what has been typed so far.
  const [typed, setTyped] = useState("");
  // For a text to copy: whether the last copy worked.
  const [copied, setCopied] = useState<boolean | null>(null);
  const t = useTranslations();
  const copy = async (input: HTMLInputElement | null) => {
    if (request.kind !== "copy") return;
    input?.select();
    try {
      await navigator.clipboard.writeText(request.value);
      setCopied(true);
    } catch {
      // No clipboard access (e.g. not a secure context): still selected for Ctrl+C.
      setCopied(false);
    }
  };
  const copyInput = useRef<HTMLInputElement>(null);
  const code = request.kind === "confirm" ? request.code : undefined;
  const codeMatches = code === undefined || normalizeConfirmCode(typed) === code;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const finish = (ok: boolean, choice: string | null = null) => {
    if (done.current) return;
    done.current = true;
    ref.current?.close();
    if (request.kind === "confirm") request.resolve(ok);
    else if (request.kind === "choice") request.resolve(choice);
    else request.resolve();
    onDone();
  };

  const titleId = `app-dialog-title-${request.id}`;
  const messageId = `app-dialog-message-${request.id}`;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-ui="AppDialog"
      data-kind={request.kind}
      role={request.kind === "alert" ? "alertdialog" : undefined}
      aria-labelledby={request.title ? titleId : undefined}
      aria-describedby={messageId}
      // Esc: the same as cancel / close.
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      // A click on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) finish(false);
      }}
    >
      <div className={styles.body}>
        {request.title && (
          <h2 id={titleId} className={styles.title}>
            {request.title}
          </h2>
        )}
        <p id={messageId} className={styles.message} data-ui="AppDialog.message">
          {request.message}
        </p>
        {request.kind === "copy" && (
          <>
            <div className={styles.copyRow}>
              <input
                ref={copyInput}
                className={ui.field}
                data-ui="AppDialog.copyInput"
                value={request.value}
                readOnly
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => void copy(e.currentTarget)}
              />
              <button
                type="button"
                className={ui.buttonSecondary}
                onClick={() => void copy(copyInput.current)}
                data-ui="AppDialog.copyButton"
              >
                {t("dialog.copy")}
              </button>
            </div>
            {copied !== null && (
              <p className={copied ? ui.success : ui.error} role="status" data-ui="AppDialog.copyStatus">
                {copied ? t("dialog.copied") : t("dialog.copyFailed")}
              </p>
            )}
          </>
        )}
        {code !== undefined && (
          <label className={styles.codeLabel}>
            <span>
              {t("dialog.typeToConfirm")}
              <strong className={styles.code} data-ui="AppDialog.code">
                {code}
              </strong>
            </span>
            <input
              className={ui.code}
              data-ui="AppDialog.codeInput"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && codeMatches) finish(true);
              }}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={code.length + 4}
            />
          </label>
        )}
        <div className={styles.actions}>
          {request.kind === "confirm" ? (
            <>
              <button
                type="button"
                className={ui.buttonSecondary}
                data-ui="AppDialog.cancelButton"
                autoFocus={request.danger}
                onClick={() => finish(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={request.danger ? ui.danger : ui.button}
                data-ui="AppDialog.confirmButton"
                autoFocus={!request.danger && code === undefined}
                disabled={!codeMatches}
                onClick={() => finish(true)}
              >
                {request.confirmLabel}
              </button>
            </>
          ) : request.kind === "choice" ? (
            <>
              <button
                type="button"
                className={ui.buttonSecondary}
                data-ui="AppDialog.cancelButton"
                onClick={() => finish(false)}
              >
                {t("common.cancel")}
              </button>
              {request.choices.map((choice, i) => {
                const suggested = i === request.choices.length - 1;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    className={suggested ? ui.button : ui.buttonSecondary}
                    data-ui="AppDialog.choiceButton"
                    data-id={choice.value}
                    autoFocus={suggested}
                    onClick={() => finish(true, choice.value)}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </>
          ) : (
            <button
              type="button"
              className={ui.button}
              data-ui="AppDialog.closeButton"
              autoFocus={request.kind === "alert"}
              onClick={() => finish(true)}
            >
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
