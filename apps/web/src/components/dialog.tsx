"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import ui from "@/styles/ui.module.css";
import styles from "./dialog.module.css";

// The app's replacements for window.alert / confirm / prompt: the same modal
// as the other dialogs (dialog.module.css), callable from anywhere —
// components, event handlers, plain async functions:
//
//   if (!(await showConfirm("削除しますか？", { danger: true, confirmLabel: "削除" }))) return;
//
// <DialogHost /> (in the root layout) shows the requests one at a time.

type Base = { id: number; title?: string; message: string };
type Request =
  | (Base & { kind: "alert"; resolve: () => void })
  | (Base & { kind: "confirm"; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void })
  | (Base & { kind: "copy"; value: string; resolve: () => void });

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

// A selected, read-only text to copy by hand (for when the clipboard API
// isn't available, e.g. plain-http intranet installs).
export function showCopyText(message: string, value: string, options: { title?: string } = {}): Promise<void> {
  return new Promise((resolve) => enqueue({ kind: "copy", message, value, title: options.title, resolve }));
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

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    ref.current?.close();
    if (request.kind === "confirm") request.resolve(ok);
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
          <input
            className={ui.field}
            data-ui="AppDialog.copyInput"
            value={request.value}
            readOnly
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
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
                キャンセル
              </button>
              <button
                type="button"
                className={request.danger ? ui.danger : ui.button}
                data-ui="AppDialog.confirmButton"
                autoFocus={!request.danger}
                onClick={() => finish(true)}
              >
                {request.confirmLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={ui.button}
              data-ui="AppDialog.closeButton"
              autoFocus={request.kind === "alert"}
              onClick={() => finish(true)}
            >
              閉じる
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
