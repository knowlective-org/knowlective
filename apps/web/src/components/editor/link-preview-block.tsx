"use client";

import { createReactBlockSpec } from "@blocknote/react";
import styles from "./link-preview-block.module.css";

// Only http(s) links are shown as links: the props come from the shared
// document, where anyone who can edit the page can put anything.
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// A URL on a line of its own, when pasted, becomes this block instead of a
// plain link (collaborative-editor.tsx).
export function singleUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/[^\s<>"']+$/i.test(trimmed) || trimmed.length > 2000) return null;
  return safeHttpUrl(trimmed) ? trimmed : null;
}

// Link preview: a link shown as a card with the page's title,
// description and image. They're fetched once, when the block is made (by the
// server, for the person who pasted the URL), and kept in the document — the
// card doesn't ask the site again each time someone opens the page.
export const linkPreviewBlock = createReactBlockSpec(
  {
    type: "linkPreview",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
      siteName: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <LinkPreviewCard
        {...block.props}
        editable={editor.isEditable}
        onUnwrap={(href, label) =>
          editor.updateBlock(block, {
            type: "paragraph",
            content: [{ type: "link", href, content: label }],
          } as never)
        }
      />
    ),
  },
);

function LinkPreviewCard({
  url,
  title,
  description,
  image,
  siteName,
  editable,
  onUnwrap,
}: {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
  editable: boolean;
  onUnwrap: (href: string, label: string) => void;
}) {
  const href = safeHttpUrl(url);
  const imageSrc = safeHttpUrl(image);
  if (!href) {
    return (
      <div className={styles.block} contentEditable={false} data-ui="LinkPreviewBlock">
        <p className={styles.muted}>リンクがありません。</p>
      </div>
    );
  }
  const host = new URL(href).host;
  return (
    <div className={styles.block} contentEditable={false} data-ui="LinkPreviewBlock">
      <a className={styles.card} href={href} target="_blank" rel="noopener noreferrer" data-ui="LinkPreviewBlock.link">
        <span className={styles.text}>
          <span className={styles.title}>{title || href}</span>
          {description && <span className={styles.description}>{description}</span>}
          <span className={styles.site}>{siteName ? `${siteName} · ${host}` : host}</span>
        </span>
        {imageSrc && (
          // The site's own image, loaded from the site: without a referrer, so
          // the site doesn't learn which page it's shown on.
          // eslint-disable-next-line @next/next/no-img-element -- an external image of unknown size
          <img className={styles.image} src={imageSrc} alt="" loading="lazy" referrerPolicy="no-referrer" />
        )}
      </a>
      {editable && (
        <div className={styles.tools}>
          <button
            type="button"
            className={styles.toolButton}
            data-ui="LinkPreviewBlock.unwrapButton"
            onClick={() => onUnwrap(href, title || href)}
          >
            ふつうのリンクに戻す
          </button>
        </div>
      )}
    </div>
  );
}
