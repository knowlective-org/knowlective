"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { MAX_SECRET_LENGTH, WrongPassphraseError, openText, sealText, secretTextSupported } from "@/lib/secret-text";
import styles from "./masked-block.module.css";
import { BLOCK_CONFIGS } from "./block-configs";

// Masked block: text locked with a passphrase. It's sealed and opened in the
// browser (lib/secret-text.ts); the block's only prop is the sealed string,
// so the page document — and with it the server, the history, search and
// everyone who can see the page — never holds the text. The opened text and
// the passphrase stay in this component's memory, gone when it closes or is
// locked again. The passphrase is shared by other means; a lost one can't be
// recovered.
export const maskedBlock = createReactBlockSpec(BLOCK_CONFIGS.maskedText, {
  render: ({ block, editor }) => (
    <MaskedText
      sealed={block.props.sealed}
      editable={editor.isEditable}
      onSeal={(sealed) => editor.updateBlock(block, { props: { sealed } })}
    />
  ),
});

type Opened = { text: string; passphrase: string };

function MaskedText({
  sealed,
  editable,
  onSeal,
}: {
  sealed: string;
  editable: boolean;
  onSeal: (sealed: string) => void;
}) {
  const t = useTranslations("editor.masked");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The sealed string this component opened (or sealed) last: when someone
  // else seals new text into the block, it's locked again here.
  const openedFrom = useRef<string | null>(null);

  useEffect(() => {
    if (openedFrom.current !== null && openedFrom.current !== sealed) {
      openedFrom.current = null;
      setOpened(null);
      setEditing(false);
    }
  }, [sealed]);

  const lock = () => {
    openedFrom.current = null;
    setOpened(null);
    setEditing(false);
    setError("");
  };

  const seal = async (text: string, passphrase: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await sealText(text, passphrase);
      openedFrom.current = next;
      onSeal(next);
      setOpened({ text, passphrase });
      setEditing(false);
    } catch {
      setError(t("sealFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!secretTextSupported()) {
    return (
      <Frame>
        <p className={styles.error} data-ui="MaskedBlock.error">
          {t("unsupported")}
        </p>
      </Frame>
    );
  }

  // Nothing locked in it yet.
  if (!sealed || (editing && editable)) {
    if (!editable) {
      return (
        <Frame>
          <p className={styles.muted}>{t("empty")}</p>
        </Frame>
      );
    }
    return (
      <Frame>
        <SealForm
          initialText={opened?.text ?? ""}
          // Editing opened text keeps its passphrase unless a new one is typed.
          keepPassphrase={opened?.passphrase ?? null}
          busy={busy}
          error={error}
          onSubmit={(text, passphrase) => void seal(text, passphrase)}
          onCancel={opened ? () => setEditing(false) : undefined}
        />
      </Frame>
    );
  }

  if (!opened) {
    return (
      <Frame>
        <UnlockForm
          busy={busy}
          error={error}
          onSubmit={async (passphrase) => {
            setBusy(true);
            setError("");
            try {
              const text = await openText(sealed, passphrase);
              openedFrom.current = sealed;
              setOpened({ text, passphrase });
            } catch (err) {
              setError(err instanceof WrongPassphraseError ? t("wrongPassphrase") : t("broken"));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <div className={styles.text} data-ui="MaskedBlock.text">
        {opened.text}
      </div>
      <div className={styles.tools}>
        {editable && (
          <button type="button" className={styles.toolButton} data-ui="MaskedBlock.editButton" onClick={() => setEditing(true)}>
            {t("edit")}
          </button>
        )}
        <button type="button" className={styles.toolButton} data-ui="MaskedBlock.lockButton" onClick={lock}>
          {t("lock")}
        </button>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations("editor.masked");
  return (
    <div className={styles.block} contentEditable={false} data-ui="MaskedBlock">
      <div className={styles.label}>
        <span aria-hidden>🔒</span> {t("label")}
      </div>
      {children}
    </div>
  );
}

function UnlockForm({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit: (passphrase: string) => void }) {
  const t = useTranslations("editor.masked");
  const [passphrase, setPassphrase] = useState("");
  return (
    <form
      className={styles.form}
      data-ui="MaskedBlock.unlockForm"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (passphrase) onSubmit(passphrase);
      }}
    >
      <p className={styles.hidden} aria-hidden>
        ●●●●●●●●●●●●●●●●
      </p>
      <div className={styles.row}>
        <input
          type="password"
          className={styles.input}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder={t("passphrase")}
          aria-label={t("passphrase")}
          autoComplete="off"
          data-ui="MaskedBlock.passphraseInput"
        />
        <button type="submit" className={styles.primaryButton} disabled={busy || !passphrase} data-ui="MaskedBlock.unlockButton">
          {busy ? t("opening") : t("unlock")}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert" data-ui="MaskedBlock.error">
          {error}
        </p>
      )}
    </form>
  );
}

function SealForm({
  initialText,
  keepPassphrase,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initialText: string;
  keepPassphrase: string | null;
  busy: boolean;
  error: string;
  onSubmit: (text: string, passphrase: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("editor.masked");
  const [text, setText] = useState(initialText);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <form
      className={styles.form}
      data-ui="MaskedBlock.sealForm"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return setProblem(t("textRequired"));
        if (!passphrase && keepPassphrase === null) return setProblem(t("passphraseRequired"));
        if (passphrase !== confirm) return setProblem(t("mismatch"));
        setProblem("");
        onSubmit(text, passphrase || keepPassphrase!);
      }}
    >
      <textarea
        className={styles.textInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_SECRET_LENGTH}
        rows={Math.min(12, Math.max(3, text.split("\n").length + 1))}
        placeholder={t("textPlaceholder")}
        aria-label={t("textLabel")}
        spellCheck={false}
        autoFocus
        data-ui="MaskedBlock.textInput"
      />
      <div className={styles.row}>
        <input
          type="password"
          className={styles.input}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder={keepPassphrase === null ? t("passphrase") : t("newPassphrase")}
          aria-label={keepPassphrase === null ? t("passphrase") : t("newPassphrase")}
          autoComplete="new-password"
          data-ui="MaskedBlock.newPassphraseInput"
        />
        <input
          type="password"
          className={styles.input}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={t("confirmPassphrase")}
          aria-label={t("confirmPassphrase")}
          autoComplete="new-password"
          data-ui="MaskedBlock.confirmPassphraseInput"
        />
      </div>
      <p className={styles.muted}>{t("note")}</p>
      <div className={styles.row}>
        <button type="submit" className={styles.primaryButton} disabled={busy} data-ui="MaskedBlock.sealButton">
          {busy ? t("sealing") : t("seal")}
        </button>
        {onCancel && (
          <button type="button" className={styles.toolButton} onClick={onCancel} data-ui="MaskedBlock.cancelButton">
            {t("cancel")}
          </button>
        )}
      </div>
      {(problem || error) && (
        <p className={styles.error} role="alert" data-ui="MaskedBlock.error">
          {problem || error}
        </p>
      )}
    </form>
  );
}
