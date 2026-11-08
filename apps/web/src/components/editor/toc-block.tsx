"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createReactBlockSpec, useEditorChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { BLOCK_CONFIGS } from "./block-configs";
import { type TocHeading, tocHeadings } from "./toc";
import styles from "./toc-block.module.css";

// A table of contents: the page's headings (H2–H6), indented by level, each
// a link that scrolls to it. Nothing but the block is in the document: the
// list is made from the headings as they are, and follows them as they change.
export const tocBlock = createReactBlockSpec(BLOCK_CONFIGS.toc, {
  render: ({ editor }) => <TocView editor={editor as unknown as BlockNoteEditor} />,
});

function TocView({ editor }: { editor: BlockNoteEditor }) {
  const t = useTranslations("editor.toc");
  const [headings, setHeadings] = useState<TocHeading[]>(() => tocHeadings(editor.document));
  useEditorChange(() => setHeadings(tocHeadings(editor.document)), editor);

  const jump = (id: string) => {
    const target = editor.domElement?.querySelector(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className={styles.toc} contentEditable={false} aria-label={t("label")} data-ui="TocBlock">
      <div className={styles.title}>{t("label")}</div>
      {headings.length === 0 ? (
        <p className={styles.empty} data-ui="TocBlock.empty">
          {t("empty")}
        </p>
      ) : (
        <div role="list">
          {headings.map((h) => (
            <div key={h.id} role="listitem" className={styles.item} style={{ paddingLeft: `${(h.level - 2) * 16}px` }}>
              <a
                href={`#${h.id}`}
                className={styles.link}
                data-ui="TocBlock.headingLink"
                data-id={h.id}
                data-level={h.level}
                onClick={(e) => {
                  e.preventDefault();
                  jump(h.id);
                }}
              >
                {h.text}
              </a>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
