import nodemailer from "nodemailer";
import { decrypt, encrypt, loadDataKey, type MailSettings, type SmtpSecurity } from "shared";
import { prisma } from "@/lib/db";

// Outgoing mail over SMTP, configured from /admin (MailSettings).
// The SMTP password is encrypted with the instance data key.

const PASSWORD_AAD = "yosuga:smtp-password";
// Fail fast instead of hanging a request on an unreachable server.
const TIMEOUT_MS = 15_000;

export type MailSettingsView = Omit<MailSettings, "passwordEnc" | "id"> & { hasPassword: boolean };

export async function getMailSettings(): Promise<MailSettingsView | null> {
  const settings = await prisma.mailSettings.findUnique({
    where: { id: 1 },
    omit: { id: true, passwordEnc: true },
  });
  if (!settings) return null;
  const hasPassword =
    (await prisma.mailSettings.count({ where: { id: 1, passwordEnc: { not: null } } })) > 0;
  return { ...settings, hasPassword };
}

export type MailSettingsInput = {
  fromAddress: string;
  fromName: string | null;
  host: string;
  port: number;
  security: SmtpSecurity;
  authEnabled: boolean;
  username: string | null;
  // undefined = keep the stored password; string = replace it.
  password: string | undefined;
};

export async function saveMailSettings(input: MailSettingsInput): Promise<void> {
  const { password, ...fields } = input;
  const data = {
    ...fields,
    username: fields.authEnabled ? fields.username : null,
    // Turning SMTP AUTH off also forgets the password.
    ...(!fields.authEnabled
      ? { passwordEnc: null }
      : password !== undefined
        ? { passwordEnc: Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(password, "utf8"), PASSWORD_AAD)) }
        : {}),
  };
  await prisma.mailSettings.upsert({ where: { id: 1 }, create: data, update: data });
}

function transportFor(settings: MailSettings, password: string | null) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // TLS: encrypted from the first byte. STARTTLS: upgrade is mandatory, so a
    // server (or attacker) that strips STARTTLS can't downgrade to plaintext.
    secure: settings.security === "TLS",
    requireTLS: settings.security === "STARTTLS",
    ignoreTLS: settings.security === "NONE",
    auth:
      settings.authEnabled && settings.username
        ? { user: settings.username, pass: password ?? "" }
        : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Mail (SMTP) settings have not been configured");
  }
}

export async function isMailConfigured(): Promise<boolean> {
  return (await prisma.mailSettings.count()) > 0;
}

export async function sendMail(message: { to: string; subject: string; text: string }): Promise<void> {
  const settings = await prisma.mailSettings.findUnique({ where: { id: 1 } });
  if (!settings) throw new MailNotConfiguredError();
  const password = settings.passwordEnc
    ? decrypt(await loadDataKey(prisma), settings.passwordEnc, PASSWORD_AAD).toString("utf8")
    : null;
  const transport = transportFor(settings, password);
  try {
    await transport.sendMail({
      from: settings.fromName
        ? { name: settings.fromName, address: settings.fromAddress }
        : settings.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } finally {
    transport.close();
  }
}
