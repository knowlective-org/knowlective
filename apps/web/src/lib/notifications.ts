import { decrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { getVisibleTrees } from "@/lib/page-access";
import type { NotificationKind } from "@/lib/notification-prefs";

// The app's side of notifications (made by server/notifications.ts): the
// list, the unread count, and marking them read.

const LIST_SIZE = 100;
const excerptAad = (id: string) => `knowlective:notification:${id}`;

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  pageId: string;
  pageTitle: string;
  // null: not someone's doing (a TODO past its date).
  actor: string | null;
  excerpt: string | null;
  createdAt: string;
  read: boolean;
};

// The page of each unread notification (the sidebar counts those on pages
// the person can still open, as the list shows).
export async function unreadNotificationPages(userId: string): Promise<string[]> {
  const rows = await prisma.notification.findMany({ where: { userId, readAt: null }, select: { pageId: true }, take: 1000 });
  return rows.map((r) => r.pageId);
}

// The latest notifications, for pages the person can still open (a page they
// lost access to, or one in the trash, isn't shown, nor its title).
export async function listNotifications(userId: string): Promise<NotificationView[]> {
  const [rows, trees] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: LIST_SIZE,
      include: { actor: { select: { name: true, emailEnc: true } } },
    }),
    getVisibleTrees(prisma, userId),
  ]);
  const titles = new Map(trees.flatMap((t) => t.pages.map((p) => [p.id, p.title] as const)));
  const key = await loadDataKey(prisma);
  const views: NotificationView[] = [];
  for (const row of rows) {
    const pageTitle = titles.get(row.pageId);
    if (pageTitle === undefined) continue;
    views.push({
      id: row.id,
      kind: row.kind,
      pageId: row.pageId,
      pageTitle,
      actor: row.actor ? await displayName(row.actor) : row.actorId ? "" : null,
      excerpt: row.excerptEnc ? decrypt(key, row.excerptEnc, excerptAad(row.id)).toString("utf8") : null,
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
    });
  }
  return views;
}

// The person opened the page: its notifications are read, and following it
// notifies again at the next change (server/notifications.ts).
export async function pageOpened(userId: string, pageId: string): Promise<void> {
  await Promise.all([
    prisma.notification.updateMany({ where: { userId, pageId, readAt: null }, data: { readAt: new Date() } }),
    prisma.pageFollow.updateMany({ where: { userId, pageId, notifiedAt: { not: null } }, data: { notifiedAt: null } }),
  ]);
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
