import { type AddressInfo, createServer } from "node:net";
import { withPrisma } from "./db";

// Mail sent by the site during a test, received by a minimal SMTP server on
// this machine. While it runs, the site's mail settings point at it; close()
// puts the previous settings (or none) back.

export type CapturedMail = { to: string; subject: string; text: string };

function decodeBody(headers: string, body: string): string {
  const encoding = /^content-transfer-encoding:\s*(\S+)/im.exec(headers)?.[1].toLowerCase();
  if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (encoding === "quoted-printable") {
    const bytes = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  return body;
}

function decodeHeader(value: string): string {
  return value.replace(/=\?utf-8\?([BQ])\?([^?]*)\?=/gi, (_, kind: string, text: string) =>
    kind.toUpperCase() === "B"
      ? Buffer.from(text, "base64").toString("utf8")
      : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"),
  );
}

function parse(raw: string, to: string): CapturedMail {
  const split = raw.indexOf("\r\n\r\n");
  const headers = raw.slice(0, split).replace(/\r\n[ \t]+/g, " ");
  const body = raw.slice(split + 4);
  const subject = decodeHeader(/^subject:\s*(.*)$/im.exec(headers)?.[1] ?? "");
  return { to, subject, text: decodeBody(headers, body) };
}

export async function startMailCapture() {
  const mails: CapturedMail[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let to = "";
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 e2e ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          mails.push(parse(Buffer.from(buffer.slice(0, end), "latin1").toString("latin1"), to));
          buffer = buffer.slice(end + 5);
          inData = false;
          reply("250 OK");
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") reply("250 e2e");
        else if (command === "RCPT") {
          to = /<([^>]+)>/.exec(line)?.[1] ?? "";
          reply("250 OK");
        } else if (command === "DATA") {
          inData = true;
          reply("354 go ahead");
        } else if (command === "QUIT") {
          reply("221 bye");
          socket.end();
        } else reply("250 OK");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const previous = await withPrisma((prisma) => prisma.mailSettings.findUnique({ where: { id: 1 } }));
  const settings = { fromAddress: "e2e@example.com", fromName: null, host: "127.0.0.1", port, security: "NONE" as const, authEnabled: false, username: null, passwordEnc: null };
  await withPrisma((prisma) => prisma.mailSettings.upsert({ where: { id: 1 }, create: settings, update: settings }));

  return {
    // The next mail to `to` (waits for it).
    async next(to: string, timeoutMs = 15_000): Promise<CapturedMail> {
      const start = Date.now();
      const seen = mails.filter((m) => m.to === to).length;
      for (;;) {
        const forTo = mails.filter((m) => m.to === to);
        if (forTo.length > seen) return forTo[seen];
        if (Date.now() - start > timeoutMs) throw new Error(`No mail to ${to}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    // Mails so far to `to`.
    count: (to: string) => mails.filter((m) => m.to === to).length,
    async close() {
      await withPrisma(async (prisma) => {
        if (previous) {
          const { fromAddress, fromName, host, port, security, authEnabled, username, passwordEnc } = previous;
          await prisma.mailSettings.update({
            where: { id: 1 },
            data: { fromAddress, fromName, host, port, security, authEnabled, username, passwordEnc },
          });
        } else {
          await prisma.mailSettings.deleteMany({});
        }
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
