"use client";

import { useTranslations } from "next-intl";
import { createReactInlineContentSpec } from "@blocknote/react";
import { usePageEditor } from "./page-context";
import { usePagePeople } from "./page-people";
import styles from "./mention-inline.module.css";
import { INLINE_CONFIGS } from "./block-configs";

// A mention (@name) in a block's text, made from the "@" menu
// (collaborative-editor.tsx). Holds only the user id: the name is shown from
// the page's people, so it follows renames, and someone not logged in (a
// public page) sees no names.
export const mentionInline = createReactInlineContentSpec(INLINE_CONFIGS.mention, {
  render: ({ inlineContent }) => <Mention userId={inlineContent.props.userId} />,
});

function Mention({ userId }: { userId: string }) {
  const t = useTranslations("notifications.mention");
  const { pageId } = usePageEditor();
  const people = usePagePeople(pageId);
  const name = people?.find((p) => p.id === userId)?.name;
  return (
    <span className={styles.mention} data-ui="Mention" data-id={userId}>
      {name ? `@${name}` : people ? t("unknown") : t("someone")}
    </span>
  );
}
