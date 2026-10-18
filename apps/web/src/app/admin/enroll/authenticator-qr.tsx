"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { TOTP_ISSUER, otpauthUri } from "@/lib/admin/otpauth";
import styles from "@/styles/ui.module.css";
import { QR_OPTIONS } from "./qr-options";

// Long enough for any email address (the default name for an account).
const MAX_NAME_LENGTH = 254;

// QR code whose entry name can be changed before scanning. The name only ends
// up in the authenticator app: the QR code is redrawn here in the browser and
// the input is outside the form, so it is never sent to or stored on the server.
export function AuthenticatorQr({
  secretBase32,
  defaultName,
  initialQr,
}: {
  secretBase32: string;
  defaultName: string;
  initialQr: string;
}) {
  const [name, setName] = useState(defaultName);
  const [qr, setQr] = useState(initialQr);
  const t = useTranslations("admin.enroll");

  useEffect(() => {
    let stale = false;
    const account = name.trim() || defaultName;
    QRCode.toDataURL(otpauthUri(secretBase32, account), QR_OPTIONS).then((url) => {
      if (!stale) setQr(url);
    });
    return () => {
      stale = true;
    };
  }, [name, defaultName, secretBase32]);

  return (
    <div data-ui="AuthenticatorQr">
      <label>
        {t("appName")}
        <span className={styles.prefixedField}>
          <span aria-hidden="true">{TOTP_ISSUER}:</span>
          <input
            data-ui="AuthenticatorQr.nameInput"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            spellCheck={false}
            className={styles.field}
          />
        </span>
      </label>
      <p className={styles.note}>
        {t("appNameNote")}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
      <img src={qr} alt={t("qrAlt")} className={styles.qr} data-ui="AuthenticatorQr.qrCode" />
    </div>
  );
}
