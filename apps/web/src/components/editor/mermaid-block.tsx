"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import styles from "./mermaid-block.module.css";

// Wait this long after the last keystroke before redrawing / saving.
const RENDER_DELAY_MS = 300;
const SAVE_DELAY_MS = 500;
export const MAX_MERMAID_LENGTH = 20000;


type Mermaid = (typeof import("mermaid"))["default"];
let mermaidLoading: Promise<Mermaid> | undefined;

// Mermaid is large, so it's only downloaded once a page shows a diagram.
// "strict" keeps diagram text from adding HTML or click handlers: the source
// is written by anyone who can edit the page.
export function loadMermaid(): Promise<Mermaid> {
  mermaidLoading ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    return mermaid;
  });
  return mermaidLoading;
}

// Mermaid diagram block: a diagram drawn from Mermaid source. The source is the block's
// `code` prop (a plain string: when two people edit it at once, the last save
// wins).
export const mermaidBlock = createReactBlockSpec(
  {
    type: "mermaid",
    propSchema: {
      code: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <MermaidDiagram
        code={block.props.code}
        editable={editor.isEditable}
        onChange={(code) => editor.updateBlock(block, { props: { code } })}
      />
    ),
  },
);

type Drawing = { svg?: string; error?: string };

function MermaidDiagram({
  code,
  editable,
  onChange,
}: {
  code: string;
  editable: boolean;
  onChange: (code: string) => void;
}) {
  // What's being typed and not saved yet; null shows the saved source.
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(editable && code === "");
  const [drawing, setDrawing] = useState<Drawing>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const renders = useRef(0);
  const baseId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const source = (draft ?? code).trim();
  const t = useTranslations("editor.mermaid");

  useEffect(() => {
    if (!source) return;
    let stale = false;
    const timer = setTimeout(
      async () => {
        const id = `${baseId}-${++renders.current}`;
        try {
          const mermaid = await loadMermaid();
          await mermaid.parse(source);
          const { svg } = await mermaid.render(id, source);
          if (!stale) setDrawing({ svg });
        } catch (err) {
          // Mermaid can leave its work element behind when drawing fails.
          document.getElementById(`d${id}`)?.remove();
          // Keep the last good drawing on screen while the source is being fixed.
          if (!stale) setDrawing((prev) => ({ svg: prev.svg, error: err instanceof Error ? err.message : String(err) }));
        }
      },
      draft === null ? 0 : RENDER_DELAY_MS,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [source, baseId, draft]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const save = (next: string) => {
    clearTimeout(saveTimer.current);
    if (next !== code) onChange(next);
  };

  return (
    <div className={styles.block} contentEditable={false} data-ui="MermaidBlock">
      {!source ? (
        <p className={styles.muted}>
          {editable ? t("emptyEditable") : t("empty")}
        </p>
      ) : drawing.svg ? (
        <div
          className={styles.diagram}
          role="img"
          aria-label={t("diagramLabel")}
          data-ui="MermaidBlock.diagram"
          // Drawn by Mermaid with securityLevel "strict".
          dangerouslySetInnerHTML={{ __html: drawing.svg }}
        />
      ) : (
        !drawing.error && <p className={styles.muted}>{t("drawing")}</p>
      )}
      {source && drawing.error && (
        <pre className={styles.error} data-ui="MermaidBlock.error">
          {t("failed")}
          {"\n"}
          {drawing.error}
        </pre>
      )}
      {editable && (
        <div className={styles.tools}>
          <button
            type="button"
            className={styles.toolButton}
            data-ui="MermaidBlock.editButton"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? t("closeSource") : t("editSource")}
          </button>
        </div>
      )}
      {editable && editing && (
        <textarea
          className={styles.code}
          data-ui="MermaidBlock.codeInput"
          value={draft ?? code}
          // Raw: the sample's braces aren't message placeholders.
          placeholder={t.raw("placeholder")}
          maxLength={MAX_MERMAID_LENGTH}
          rows={Math.min(20, Math.max(5, (draft ?? code).split("\n").length + 1))}
          spellCheck={false}
          aria-label={t("sourceLabel")}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
          }}
          onBlur={(e) => {
            save(e.target.value);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}
