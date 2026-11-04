"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { showAlert } from "@/components/dialog";
import styles from "./page-view.module.css";
import { setPageFollow } from "./follow-actions";

// Follow / Following, at the top of the page: a followed page's changes by
// others are notified.
export function FollowButton({ pageId, initial }: { pageId: string; initial: boolean }) {
  const t = useTranslations("notifications.follow");
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={following ? `${styles.share} ${styles.following}` : styles.share}
      aria-pressed={following}
      title={following ? t("followingHint") : t("followHint")}
      disabled={busy}
      data-ui="PageView.followButton"
      onClick={async () => {
        setBusy(true);
        try {
          const { ok } = await setPageFollow(pageId, !following).catch(() => ({ ok: false }));
          if (ok) setFollowing(!following);
          else await showAlert(t("failed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {following ? `✓ ${t("following")}` : t("follow")}
    </button>
  );
}
