import type { Metadata } from "next";
import Link from "next/link";
import { messageParts } from "@/lib/page-message-text";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";
import { requireUser } from "@/lib/auth/session";
import { listNotifications } from "@/lib/notifications";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import ui from "@/styles/ui.module.css";
import styles from "./notifications.module.css";
import { markAllNotificationsRead } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("notifications.title") };
}

// The signed-in person's notifications, newest first. A notification links
// to its page; opening the page marks its notifications read.
export default async function NotificationsPage() {
  await connection();
  const user = await requireUser("/notifications");
  const [sidebar, items, t, format, displayTitle] = await Promise.all([
    loadSidebar(user),
    listNotifications(user.id),
    getTranslations("notifications"),
    getFormatter(),
    getDisplayTitle(),
  ]);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={ui.pane} data-ui="NotificationsPage">
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.lead}>{t("lead")}</p>
        {items.some((i) => !i.read) && (
          <form action={markAllNotificationsRead} className={styles.actions}>
            <button type="submit" className={ui.buttonSecondary} data-ui="NotificationsPage.markAllReadButton">
              {t("markAllRead")}
            </button>
          </form>
        )}
        {items.length === 0 ? (
          <p className={ui.note} data-ui="NotificationsPage.empty">
            {t("empty")}
          </p>
        ) : (
          <div className={styles.list} role="list">
            {items.map((item) => {
              const heading = (
                <span className={styles.text}>
                  {!item.read && <span className={styles.dot} aria-label={t("unread")} />}
                  {t(`kind.${item.kind}`, { actor: item.actor || t("someone"), page: displayTitle(item.pageTitle) })}
                </span>
              );
              const time = (
                <time className={styles.time} dateTime={item.createdAt}>
                  {format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                </time>
              );
              const className = item.read ? styles.item : `${styles.item} ${styles.unread}`;
              // A message (API / MCP) is shown whole, its URLs as links: so
              // the item isn't one link (links can't be nested); its heading
              // opens the page.
              if (item.kind === "MESSAGE") {
                return (
                  <div key={item.id} className={className} role="listitem" data-ui="NotificationsPage.messageItem" data-id={item.id} data-read={item.read || undefined}>
                    <Link href={`/pages/${item.pageId}`} className={styles.headingLink} data-ui="NotificationsPage.itemLink" data-id={item.id} data-kind={item.kind}>
                      {heading}
                    </Link>
                    {item.excerpt && (
                      <p className={styles.message} data-ui="NotificationsPage.message">
                        {messageParts(item.excerpt).map((part, i) =>
                          part.href ? (
                            <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" data-ui="NotificationsPage.messageLink">
                              {part.text}
                            </a>
                          ) : (
                            part.text
                          ),
                        )}
                      </p>
                    )}
                    {time}
                  </div>
                );
              }
              return (
                <Link
                  key={item.id}
                  href={`/pages/${item.pageId}`}
                  className={className}
                  role="listitem"
                  data-ui="NotificationsPage.itemLink"
                  data-id={item.id}
                  data-kind={item.kind}
                  data-read={item.read || undefined}
                >
                  {heading}
                  {item.excerpt && <span className={styles.excerpt}>{item.excerpt}</span>}
                  {time}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
