"use server";

import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { createRateLimiter } from "@/lib/rate-limit";
import { NOTIFICATION_KINDS, type NotificationPrefs, parseNotificationPrefs } from "@/lib/notification-prefs";
import { pushPublicKey, sendTestPush } from "@/lib/notification-bridge";
import { endpointHash, isPushEndpoint, parsePushSubscription, subscriptionAad } from "@/lib/push-endpoint";

// The account screen's notifications: which ones, details in desktop
// notifications, and this browser's desktop notifications (Web Push).

// Devices one person can have desktop notifications on.
const MAX_DEVICES = 20;
const testLimit = createRateLimiter(60_000, 5);

export type NotificationPrefsState = { saved?: boolean; error?: string };

export async function saveNotificationPrefs(_prev: NotificationPrefsState, formData: FormData): Promise<NotificationPrefsState> {
  const user = await requireUser();
  const enabled = formData.get("enabled") === "on";
  // While all are off, the other choices aren't sent (disabled): kept as they were.
  const before = enabled
    ? null
    : parseNotificationPrefs((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notificationPrefs: true } })).notificationPrefs);
  const kinds = before?.kinds ?? (Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, formData.get(k) === "on"])) as NotificationPrefs["kinds"]);
  const pushDetails = before?.pushDetails ?? formData.get("pushDetails") === "on";
  const prefs: NotificationPrefs = { enabled, kinds, pushDetails };
  await prisma.user.update({ where: { id: user.id }, data: { notificationPrefs: prefs } });
  return { saved: true };
}

// What this browser needs to ask for desktop notifications: the server's
// public key, or null when the site has them turned off.
export async function pushSetup(): Promise<{ publicKey: string | null }> {
  await requireUser();
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { pushNotificationsEnabled: true } });
  if (!config?.pushNotificationsEnabled) return { publicKey: null };
  return { publicKey: await pushPublicKey() };
}

// This browser's subscription (PushSubscription.toJSON()). Only the
// browsers' push services are accepted (lib/push-endpoint.ts): the server
// sends to the address given.
export async function savePushSubscription(raw: unknown): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("notifications.settings");
  const subscription = parsePushSubscription(raw);
  if (!subscription) return { error: t("failed") };
  const hash = endpointHash(subscription.endpoint);
  const existing = await prisma.pushSubscription.findUnique({ where: { endpointHash: hash }, select: { id: true } });
  if (!existing && (await prisma.pushSubscription.count({ where: { userId: user.id } })) >= MAX_DEVICES) {
    // The oldest device makes room.
    const oldest = await prisma.pushSubscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    if (oldest) await prisma.pushSubscription.delete({ where: { id: oldest.id } });
  }
  const id = existing?.id ?? randomUUID();
  const dataEnc = Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(JSON.stringify(subscription)), subscriptionAad(id)));
  // The same browser signed in as someone else now: it's theirs.
  await prisma.pushSubscription.upsert({
    where: { endpointHash: hash },
    create: { id, userId: user.id, endpointHash: hash, dataEnc },
    update: { userId: user.id, dataEnc },
  });
  return {};
}

export async function removePushSubscription(endpoint: unknown): Promise<void> {
  const user = await requireUser();
  if (!isPushEndpoint(endpoint)) return;
  await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpointHash: endpointHash(endpoint) } });
}

// Whether this browser's subscription is the signed-in person's.
export async function hasPushSubscription(endpoint: unknown): Promise<boolean> {
  const user = await requireUser();
  if (!isPushEndpoint(endpoint)) return false;
  return (await prisma.pushSubscription.count({ where: { userId: user.id, endpointHash: endpointHash(endpoint) } })) > 0;
}

export async function testDesktopNotification(): Promise<{ sent: number }> {
  const user = await requireUser();
  if (testLimit(user.id) !== null) return { sent: 0 };
  return { sent: await sendTestPush(user.id) };
}
