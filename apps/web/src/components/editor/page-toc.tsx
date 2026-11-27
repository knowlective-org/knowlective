"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { useEditorChange } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { useReview } from "./review-pane";
import { type TocHeading, tocHeadings } from "./toc";
import styles from "./page-toc.module.css";

// A document page's table of contents on the right of its body (wide screens
// only, never printed or exported): the page's headings (H2–H6), the one
// being read marked, each scrolling to its heading. Made from the headings as
// they are, like the toc block (toc-block.tsx). Not shown while a review
// thread is open (its pane takes the right side) or when there's no heading.
export function PageTocLayout({ editor, children }: { editor: BlockNoteEditor; children: ReactNode }) {
  const [headings, setHeadings] = useState<TocHeading[]>(() => tocHeadings(editor.document));
  useEditorChange(() => setHeadings(tocHeadings(editor.document)), editor);
  const review = useReview();
  const shown = headings.length > 0 && !review?.activeId;

  return (
    <div className={shown ? styles.layout : undefined} data-ui="PageTocLayout">
      <div className={styles.body}>{children}</div>
      {shown && <PageToc editor={editor} headings={headings} />}
    </div>
  );
}

function PageToc({ editor, headings }: { editor: BlockNoteEditor; headings: TocHeading[] }) {
  const t = useTranslations("editor.toc");
  const current = useCurrentHeading(editor, headings);

  const jump = (id: string) => {
    blockElement(editor, id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className={styles.toc} aria-label={t("label")} data-ui="PageToc">
      <div className={styles.title}>{t("label")}</div>
      <div role="list">
        {headings.map((h) => (
          <div key={h.id} role="listitem" style={{ paddingLeft: `${(h.level - 2) * 12}px` }}>
            <a
              href={`#${h.id}`}
              className={h.id === current ? styles.linkCurrent : styles.link}
              aria-current={h.id === current ? "location" : undefined}
              data-ui="PageToc.headingLink"
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
    </nav>
  );
}

function blockElement(editor: BlockNoteEditor, id: string): Element | null | undefined {
  return editor.domElement?.querySelector(`.bn-block-outer[data-id="${CSS.escape(id)}"]`);
}

// The heading being read: the last one whose top has passed the top of the
// window (under the page's sticky bar), or the first one before that. At the
// bottom of the page (where the last headings can't scroll up that far): the
// last one in the window.
function useCurrentHeading(editor: BlockNoteEditor, headings: TocHeading[]): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let found: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        const el = blockElement(editor, h.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= 96 || (atBottom && top < window.innerHeight)) found = h.id;
      }
      setCurrent(found);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, headings]);
  return current;
}
