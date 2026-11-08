import { randomUUID } from "node:crypto";
import webpush from "web-push";
import * as Y from "yjs";
import { decrypt, encrypt, getPageAccess, loadDataKey, openEmail, type PrismaClient } from "shared";
import { docNotices } from "../src/lib/doc-notices";
import { type NotificationKind, parseNotificationPrefs, wantsNotification } from "../src/lib/notification-prefs";
import { type ChatPostedEvent, registerNotificationBridge } from "../src/lib/notification-bridge";
import { type PushSubscriptionData, isPushEndpoint, subscriptionAad } from "../src/lib/push-endpoint";
import { loadOutboundProxy, proxyForHost } from "../src/lib/outbound-proxy";
import { FALLBACK_LOCALE, isLocale } from "../src/i18n/locales";
import { translatorFor } from "../src/i18n/translator";

// Notifications: new chat messages (to those who posted in the chat, follow
// the page or are mentioned on it), a TODO given to someone or past its date
// (to its assignee), changes to a followed page (to its followers, once until
// they open it again or an hour has passed), mentions (to who's mentioned).
//
// Each is a Notification row (the app's list, /notifications) and, on the
// devices that asked for it, a desktop notification (Web Push). Recipients
// are checked when notified: an enabled account that can open the page
// (deleted pages can't be), wanting that kind (lib/notification-prefs.ts);
// the one who did it isn't told. Runs in the custom server: the collab
// server's store (TODOs, mentions, page changes), the overdue check, and the
// bridge for the app (chat, lib/notification-bridge.ts).
//
// What's sent through the push services is encrypted for the device (Web
// Push); the person chooses whether it says who, which page and an excerpt,
// or only the kind of event.

const EXCERPT_LENGTH = 120;
// A followed page notifies again after this, even if it wasn't opened.
const FOLLOW_QUIET_MS = 60 * 60_000;
const OVERDUE_INTERVAL_MS = 60 * 60_000;

const excerptAad = (id: string) => `knowlective:notification:${id}`;

type NotifyEvent = {
  kind: NotificationKind;
  pageId: string;
  actorId: string | null;
  recipients: Iterable<string>;
  excerpt?: string;
};

export function createNotifier(prisma: PrismaClient) {
  // The VAPID key pair, made once and kept (encrypted).
  let vapid: Promise<{ publicKey: string; privateKey: string }> | null = null;
  const vapidKeys = () =>
    (vapid ??= (async () => {
      const key = await loadDataKey(prisma);
      const stored = await prisma.pushKeys.findUnique({ where: { id: 1 } });
      if (stored) return { publicKey: stored.publicKey, privateKey: decrypt(key, stored.privateKeyEnc, "knowlective:push-keys").toString() };
      const made = webpush.generateVAPIDKeys();
      const row = await prisma.pushKeys.upsert({
        where: { id: 1 },
        create: {
          publicKey: made.publicKey,
          privateKeyEnc: Uint8Array.from(encrypt(key, Buffer.from(made.privateKey), "knowlective:push-keys")),
        },
        update: {},
      });
      // Another instance may have made them first: use the stored pair.
      return row.publicKey === made.publicKey
        ? made
        : { publicKey: row.publicKey, privateKey: decrypt(key, row.privateKeyEnc, "knowlective:push-keys").toString() };
    })().catch((err) => {
      vapid = null;
      throw err;
    }));

  async function notify(event: NotifyEvent): Promise<void> {
    const ids = [...new Set(event.recipients)].filter((id) => id !== event.actorId);
    if (ids.length === 0) return;
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, disabledAt: null },
      select: { id: true, notificationPrefs: true, locale: true },
    });
    const recipients = [];
    for (const user of users) {
      if (!wantsNotification(parseNotificationPrefs(user.notificationPrefs), event.kind)) continue;
      if (!(await getPageAccess(prisma, user.id, event.pageId))) continue;
      recipients.push(user);
    }
    if (recipients.length === 0) return;

    const key = await loadDataKey(prisma);
    const excerpt = event.excerpt?.replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH) || null;
    const rows = recipients.map((user) => {
      const id = randomUUID();
      return {
        id,
        userId: user.id,
        kind: event.kind,
        pageId: event.pageId,
        actorId: event.actorId,
        excerptEnc: excerpt ? Uint8Array.from(encrypt(key, Buffer.from(excerpt, "utf8"), excerptAad(id))) : null,
      };
    });
    await prisma.notification.createMany({ data: rows });
    // Not waited for: a slow push service mustn't hold up a save.
    void push(event, excerpt, recipients).catch((err) => console.error("[notifications] sending desktop notifications failed", err));
  }

  async function push(event: NotifyEvent, excerpt: string | null, recipients: { id: string; notificationPrefs: unknown; locale: string | null }[]) {
    const config = await prisma.instanceConfig.findUnique({
      where: { id: 1 },
      select: { pushNotificationsEnabled: true, defaultLocale: true, publicUrl: true },
    });
    if (!config?.pushNotificationsEnabled) return;
    const devices = await prisma.pushSubscription.findMany({ where: { userId: { in: recipients.map((r) => r.id) } } });
    if (devices.length === 0) return;
    const [key, page, actor, brand] = await Promise.all([
      loadDataKey(prisma),
      prisma.page.findUnique({ where: { id: event.pageId }, select: { title: true } }),
      event.actorId ? prisma.user.findUnique({ where: { id: event.actorId }, select: { name: true, emailEnc: true } }) : null,
      prisma.brandSettings.findUnique({ where: { id: 1 }, select: { name: true } }),
    ]);
    const actorName = actor ? actor.name || (actor.emailEnc ? openEmail(key, actor.emailEnc) : "") : "";
    const siteName = brand?.name || "KNOWLECTIVE";

    for (const device of devices) {
      const recipient = recipients.find((r) => r.id === device.userId)!;
      const locale = isLocale(recipient.locale) ? recipient.locale : isLocale(config.defaultLocale) ? config.defaultLocale : FALLBACK_LOCALE;
      const t = translatorFor(locale);
      const details = parseNotificationPrefs(recipient.notificationPrefs).pushDetails;
      const untitled = t("common.untitled");
      const message = details
        ? {
            title: t(`notifications.kind.${event.kind}`, { actor: actorName || t("notifications.someone"), page: page?.title || untitled }),
            body: excerpt ?? "",
          }
        : { title: siteName, body: t(`notifications.push.${event.kind}`) };
      await sendTo(
        device,
        {
          ...message,
          // Relative to the service worker's scope (the site, base path included).
          url: `pages/${event.pageId}`,
          // One per page and kind on screen at a time.
          tag: `${event.kind}:${event.pageId}`,
        },
        config.publicUrl,
      );
    }
  }

  // Pages from before notifications get their TODOs and mentions recorded at
  // start-up, without notifying (baseline()); until that's done, a page with
  // no record is treated the same way. After it, a page with no record is a
  // new one, and everything on it is new.
  let baselineDone = false;

  async function baseline(): Promise<void> {
    const key = await loadDataKey(prisma);
    for (;;) {
      const pages = await prisma.pageDocument.findMany({
        where: { page: { notifyIndex: null } },
        select: { pageId: true, state: true },
        take: 50,
      });
      if (pages.length === 0) break;
      for (const { pageId, state } of pages) {
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, decrypt(key, state, pageId));
          await record(pageId, docNotices(doc), new Map());
        } catch (err) {
          console.error(`[notifications] recording page ${pageId} failed`, err);
          await prisma.pageNotifyIndex.upsert({ where: { pageId }, create: { pageId }, update: {} });
        } finally {
          doc.destroy();
        }
      }
    }
    baselineDone = true;
  }

  // Stores a page's TODOs and mentions as they are now.
  async function record(
    pageId: string,
    { todos, mentions }: ReturnType<typeof docNotices>,
    previous: Map<string, { due: string | null; assigneeId: string | null; overdueNotified: string | null }>,
  ) {
    await prisma.$transaction([
      prisma.pageTodoItem.deleteMany({ where: { pageId } }),
      prisma.pageTodoItem.createMany({
        data: todos.map((t) => {
          const p = previous.get(t.blockId);
          return {
            pageId,
            blockId: t.blockId,
            assigneeId: t.assigneeId,
            due: t.due,
            checked: t.checked,
            // Notified for this date already, and still for the same person.
            overdueNotified: p && p.due === t.due && p.assigneeId === t.assigneeId ? p.overdueNotified : null,
          };
        }),
      }),
      prisma.pageMention.deleteMany({ where: { pageId } }),
      prisma.pageMention.createMany({ data: mentions.map((m) => ({ pageId, userId: m.userId })) }),
      prisma.pageNotifyIndex.upsert({ where: { pageId }, create: { pageId }, update: { indexedAt: new Date() } }),
    ]);
  }

  // After a page was stored: new TODO assignees and new mentions, and the
  // page's followers (if someone edited it).
  async function pageStored(pageId: string, document: Y.Doc, editorId: string | null): Promise<void> {
    const notices = docNotices(document);
    const { todos, mentions } = notices;
    const [indexRow, before, mentionedBefore] = await Promise.all([
      prisma.pageNotifyIndex.findUnique({ where: { pageId } }),
      prisma.pageTodoItem.findMany({ where: { pageId } }),
      prisma.pageMention.findMany({ where: { pageId }, select: { userId: true } }),
    ]);
    const previous = new Map(before.map((t) => [t.blockId, t]));
    const wasMentioned = new Set(mentionedBefore.map((m) => m.userId));
    // Compared with what was recorded: a page recorded before, or a new one
    // (nothing recorded, once the old pages are: everything on it is new).
    const compare = indexRow !== null || baselineDone;

    const changed =
      !indexRow ||
      todos.length !== before.length ||
      todos.some((t) => {
        const p = previous.get(t.blockId);
        return !p || p.assigneeId !== t.assigneeId || p.due !== t.due || p.checked !== t.checked;
      }) ||
      mentions.length !== wasMentioned.size ||
      mentions.some((m) => !wasMentioned.has(m.userId));
    if (changed) await record(pageId, notices, previous);

    if (compare) {
      for (const todo of todos) {
        if (todo.assigneeId && todo.assigneeId !== previous.get(todo.blockId)?.assigneeId) {
          await notify({ kind: "TODO_ASSIGNED", pageId, actorId: editorId, recipients: [todo.assigneeId], excerpt: todo.text });
        }
      }
      for (const mention of mentions) {
        if (!wasMentioned.has(mention.userId)) {
          await notify({ kind: "MENTION", pageId, actorId: editorId, recipients: [mention.userId], excerpt: mention.text });
        }
      }
    }

    if (editorId) {
      const now = new Date();
      const followers = await prisma.pageFollow.findMany({
        where: {
          pageId,
          userId: { not: editorId },
          OR: [{ notifiedAt: null }, { notifiedAt: { lt: new Date(now.getTime() - FOLLOW_QUIET_MS) } }],
        },
        select: { userId: true },
      });
      if (followers.length > 0) {
        const ids = followers.map((f) => f.userId);
        await prisma.pageFollow.updateMany({ where: { pageId, userId: { in: ids } }, data: { notifiedAt: now } });
        await notify({ kind: "PAGE_CHANGED", pageId, actorId: editorId, recipients: ids });
      }
    }
  }

  // Those in a chat: who posted in it, who follows its page, who the page
  // mentions. Those the message mentions are told of the mention instead.
  async function chatPosted(event: ChatPostedEvent) {
    const [posters, followers, mentioned] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { pageId: event.pageId, blockId: event.blockId, authorId: { not: null } },
        select: { authorId: true },
        distinct: ["authorId"],
      }),
      prisma.pageFollow.findMany({ where: { pageId: event.pageId }, select: { userId: true } }),
      prisma.pageMention.findMany({ where: { pageId: event.pageId }, select: { userId: true } }),
    ]);
    const mentionIds = new Set(event.mentionIds);
    await notify({ kind: "MENTION", pageId: event.pageId, actorId: event.actorId, recipients: mentionIds, excerpt: event.text });
    const inChat = [...posters.map((p) => p.authorId!), ...followers.map((f) => f.userId), ...mentioned.map((m) => m.userId)];
    await notify({
      kind: "CHAT_MESSAGE",
      pageId: event.pageId,
      actorId: event.actorId,
      recipients: inChat.filter((id) => !mentionIds.has(id)),
      excerpt: event.text,
    });
  }

  // Unfinished TODOs whose date has passed (the day after it, in the server's
  // time zone): their assignee, once per date.
  async function notifyOverdue(today = localDate(new Date())): Promise<number> {
    const items = await prisma.pageTodoItem.findMany({
      where: { checked: false, assigneeId: { not: null }, due: { lt: today } },
    });
    let count = 0;
    for (const item of items) {
      if (item.overdueNotified === item.due) continue;
      await prisma.pageTodoItem.update({
        where: { pageId_blockId: { pageId: item.pageId, blockId: item.blockId } },
        data: { overdueNotified: item.due },
      });
      await notify({ kind: "TODO_OVERDUE", pageId: item.pageId, actorId: null, recipients: [item.assigneeId!] });
      count++;
    }
    return count;
  }

  function start() {
    registerNotificationBridge({ chatPosted, pushPublicKey: async () => (await vapidKeys()).publicKey, testPush });
    const pass = async () => {
      try {
        await notifyOverdue();
      } catch (err) {
        console.error("[notifications] the overdue check failed", err);
      } finally {
        setTimeout(pass, OVERDUE_INTERVAL_MS).unref();
      }
    };
    setTimeout(pass, 60_000).unref();
    // Not waited for: the server starts meanwhile. Tried again until it works
    // (before the first setup there's no data key yet).
    const runBaseline = () =>
      void baseline().catch((err) => {
        console.error("[notifications] recording the existing pages failed", err);
        setTimeout(runBaseline, 60_000).unref();
      });
    runBaseline();
  }

  // A test from the account screen, to the person's own devices.
  async function testPush(userId: string): Promise<number> {
    const [user, config] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { locale: true } }),
      prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { pushNotificationsEnabled: true, defaultLocale: true, publicUrl: true } }),
    ]);
    if (!config?.pushNotificationsEnabled) return 0;
    const locale = isLocale(user.locale) ? user.locale : isLocale(config.defaultLocale) ? config.defaultLocale : FALLBACK_LOCALE;
    const t = translatorFor(locale);
    const devices = await prisma.pushSubscription.findMany({ where: { userId } });
    const message = { title: t("notifications.settings.testTitle"), body: t("notifications.settings.testBody"), url: "notifications", tag: "test" };
    let sent = 0;
    for (const device of devices) if (await sendTo(device, message, config.publicUrl)) sent++;
    return sent;
  }

  // Sends one desktop notification to one device; false if it didn't go.
  async function sendTo(
    device: { id: string; dataEnc: Uint8Array },
    message: { title: string; body: string; url: string; tag: string },
    publicUrl: string | null,
  ): Promise<boolean> {
    const [key, keys] = await Promise.all([loadDataKey(prisma), vapidKeys()]);
    const subscription = JSON.parse(decrypt(key, device.dataEnc, subscriptionAad(device.id)).toString()) as PushSubscriptionData;
    // Checked when saved; again here, before anything is sent there.
    if (!isPushEndpoint(subscription.endpoint)) return false;
    // VAPID needs a contact for the push services: the site's address.
    const subject = publicUrl?.startsWith("https://") ? publicUrl : "mailto:noreply@knowlective.invalid";
    // Through the outbound proxy, if any (lib/outbound-proxy.ts).
    const proxy = proxyForHost(await loadOutboundProxy(prisma), new URL(subscription.endpoint).hostname);
    try {
      await webpush.sendNotification(subscription, JSON.stringify(message), {
        ...(proxy ? { proxy } : {}),
        vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 24 * 60 * 60,
        timeout: 10_000,
      });
      return true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Gone (unsubscribed, the browser's data cleared): forget the device.
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => {});
      else console.error(`[notifications] a push service answered ${status ?? "with an error"}`);
      return false;
    }
  }

  return { pageStored, chatPosted, notifyOverdue, vapidKeys, start };
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
