"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { safeHttpUrl } from "./link-preview-block";
import { parseVideoUrl } from "./video-url";
import styles from "./video-embed-block.module.css";

// Video embed: a video on YouTube, Vimeo or Niconico, played in the page.
// The document holds only the URL that was pasted; which player to show is
// worked out from it each time (video-url.ts), so the frame can only point at
// those sites whatever is put in the prop. (A link to a video file becomes
// BlockNote's own video block instead.)
export const videoEmbedBlock = createReactBlockSpec(
  {
    type: "videoEmbed",
    propSchema: {
      url: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block, editor }) => (
      <VideoEmbed
        url={block.props.url}
        editable={editor.isEditable}
        onUnwrap={(href) =>
          editor.updateBlock(block, {
            type: "paragraph",
            content: [{ type: "link", href, content: href }],
          } as never)
        }
      />
    ),
  },
);

function VideoEmbed({ url, editable, onUnwrap }: { url: string; editable: boolean; onUnwrap: (href: string) => void }) {
  const href = safeHttpUrl(url);
  const source = href ? parseVideoUrl(href) : null;
  if (!href || source?.kind !== "embed") {
    return (
      <div className={styles.block} contentEditable={false} data-ui="VideoEmbedBlock">
        <p className={styles.muted}>再生できる動画の URL ではありません。</p>
      </div>
    );
  }
  return (
    <div className={styles.block} contentEditable={false} data-ui="VideoEmbedBlock">
      <div className={styles.frame}>
        <iframe
          className={styles.player}
          src={source.embedUrl}
          title={`${source.label} の動画`}
          // Loaded when scrolled near; the site isn't told which page it's on.
          loading="lazy"
          referrerPolicy="no-referrer"
          // The player's own scripts and full screen; no access to this page.
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          data-ui="VideoEmbedBlock.player"
        />
      </div>
      <div className={styles.bar}>
        {/* Also what's left of the block on paper. */}
        <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer" data-ui="VideoEmbedBlock.link">
          {source.label} で開く
        </a>
        {editable && (
          <button
            type="button"
            className={styles.toolButton}
            data-ui="VideoEmbedBlock.unwrapButton"
            onClick={() => onUnwrap(href)}
          >
            ふつうのリンクに戻す
          </button>
        )}
      </div>
    </div>
  );
}
