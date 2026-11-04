"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { NOTIFICATION_KINDS, type NotificationPrefs } from "@/lib/notification-prefs";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import {
  type NotificationPrefsState,
  hasPushSubscription,
  pushSetup,
  removePushSubscription,
  saveNotificationPrefs,
  savePushSubscription,
  testDesktopNotification,
} from "./notification-actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

// The account screen's notifications: which events, details in desktop
// notifications, and this browser's desktop notifications.
export function NotificationSection({ prefs }: { prefs: NotificationPrefs }) {
  return (
    <div data-ui="NotificationSection">
      <PrefsForm prefs={prefs} />
      <DesktopNotifications />
    </div>
  );
}

function PrefsForm({ prefs }: { prefs: NotificationPrefs }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(saveNotificationPrefs, {} as NotificationPrefsState);
  const [enabled, setEnabled] = useState(prefs.enabled);
  const [kinds, setKinds] = useState(prefs.kinds);
  const [pushDetails, setPushDetails] = useState(prefs.pushDetails);
  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which would put the checkboxes back to their initial values.
    <form
      data-ui="NotificationPrefsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label style={checkRow}>
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-ui="NotificationPrefsForm.enabledCheckbox"
        />
        <span>
          <strong>{t("notifications.settings.allEnabled")}</strong>
          <br />
          <span className={styles.note}>{t("notifications.settings.allEnabledNote")}</span>
        </span>
      </label>
      <p className={styles.note}>{t("notifications.settings.lead")}</p>
      {NOTIFICATION_KINDS.map((kind) => (
        <label key={kind} style={checkRow}>
          <input
            type="checkbox"
            name={kind}
            checked={kinds[kind]}
            disabled={!enabled}
            onChange={(e) => setKinds({ ...kinds, [kind]: e.target.checked })}
            data-ui="NotificationPrefsForm.kindCheckbox"
            data-id={kind}
          />
          <span>{t(`notifications.settings.kinds.${kind}`)}</span>
        </label>
      ))}
      <label style={checkRow}>
        <input
          type="checkbox"
          name="pushDetails"
          checked={pushDetails}
          disabled={!enabled}
          onChange={(e) => setPushDetails(e.target.checked)}
          data-ui="NotificationPrefsForm.pushDetailsCheckbox"
        />
        <span>
          {t("notifications.settings.pushDetails")}
          <br />
          <span className={styles.note}>{t("notifications.settings.pushDetailsNote")}</span>
        </span>
      </label>
      <StatusRow
        message={state.error ?? (state.saved ? t("common.saved") : "")}
        className={state.error ? styles.error : styles.success}
        dataUi="NotificationPrefsForm.status"
      >
        <button type="submit" disabled={pending} className={styles.button} data-ui="NotificationPrefsForm.submitButton">
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

type DeviceState = "loading" | "unsupported" | "insecure" | "siteOff" | "blocked" | "off" | "on";

// The service worker that shows desktop notifications (public/sw.js), for the
// whole site (base path included).
async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(withBasePath("/sw.js"), { scope: withBasePath("/") });
  await navigator.serviceWorker.ready;
  return registration;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function DesktopNotifications() {
  const t = useTranslations("notifications.settings");
  const [state, setState] = useState<DeviceState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await (async (): Promise<DeviceState> => {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
        if (!window.isSecureContext) return "insecure";
        const { publicKey: key } = await pushSetup();
        if (!alive) return "loading";
        setPublicKey(key);
        if (!key) return "siteOff";
        if (Notification.permission === "denied") return "blocked";
        const registration = await navigator.serviceWorker.getRegistration(withBasePath("/"));
        const subscription = await registration?.pushManager.getSubscription();
        return subscription && (await hasPushSubscription(subscription.endpoint)) ? "on" : "off";
      })().catch(() => "unsupported" as const);
      if (alive) setState(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = async () => {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setState("blocked");
        return;
      }
      const registration = await serviceWorker();
      // One made with another key (the server's keys were made again) can't be used.
      const old = await registration.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const result = await savePushSubscription(subscription.toJSON());
      if (result.error) {
        await subscription.unsubscribe();
        setMessage({ text: result.error, error: true });
        return;
      }
      setState("on");
    } catch {
      setMessage({ text: t("failed"), error: true });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(withBasePath("/"));
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const { sent } = await testDesktopNotification();
      setMessage(sent > 0 ? { text: t("testSent"), error: false } : { text: t("failed"), error: true });
    } finally {
      setBusy(false);
    }
  };

  const status = {
    loading: "",
    unsupported: t("unsupported"),
    insecure: t("needsHttps"),
    siteOff: t("siteOff"),
    blocked: t("blocked"),
    off: t("disabled"),
    on: t("enabled"),
  }[state];

  return (
    <div className={styles.form} style={{ marginTop: 32 }} data-ui="DesktopNotifications" data-state={state}>
      <h3 className={styles.sectionTitle} style={{ fontSize: 15 }}>
        {t("desktop")}
      </h3>
      <p className={styles.note}>{t("desktopNote")}</p>
      <p data-ui="DesktopNotifications.status">{status}</p>
      <div className={styles.actions}>
        {(state === "off" || state === "blocked") && (
          <button type="button" className={styles.button} disabled={busy} onClick={() => void enable()} data-ui="DesktopNotifications.enableButton">
            {t("enable")}
          </button>
        )}
        {state === "on" && (
          <>
            <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void test()} data-ui="DesktopNotifications.testButton">
              {t("test")}
            </button>
            <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void disable()} data-ui="DesktopNotifications.disableButton">
              {t("disable")}
            </button>
          </>
        )}
      </div>
      {message && (
        <p className={message.error ? styles.error : styles.success} role="status" data-ui="DesktopNotifications.messageStatus">
          {message.text}
        </p>
      )}
    </div>
  );
}
