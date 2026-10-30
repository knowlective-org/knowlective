// Must stay first: sets NODE_ENV and loads .env before anything else.
import { appDir, dev } from "./env";
import { createServer, type IncomingMessage } from "node:http";
import next from "next";
import { BASE_PATH } from "../src/lib/base-path";
import { COLLAB_PATH, createCollab } from "./collab";
import { startMarkdownBridge } from "./page-markdown";
import { createRobots } from "./robots";
import { applySecurityHeaders } from "./security-headers";

// One process, one port: the Next.js app (pages, Server Actions) and the
// collaboration WebSocket at /collab (both under KNOWLECTIVE_BASE_PATH, if set). Runs via tsx because packages/shared is
// consumed as TypeScript source.
//   pnpm dev    → tsx watch server/index.ts
//   pnpm start  → tsx server/index.ts --prod   (after `pnpm build`)

const port = Number(process.env.PORT ?? 3000);

function pathnameOf(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

// Paths open to every network: the admin console (it has its own IP
// restriction, so an administrator can always reach the network settings),
// Next.js's own assets (the admin console needs them), the health check, and
// the single sign-on callback (the admin console's sign-in comes back there;
// for the app's sign-in, the callback checks the network itself).
function exemptFromNetworkPolicy(pathname: string): boolean {
  return (
    pathname === `${BASE_PATH}/admin` ||
    pathname.startsWith(`${BASE_PATH}/admin/`) ||
    pathname.startsWith(`${BASE_PATH}/_next/`) ||
    pathname === `${BASE_PATH}/api/health` ||
    pathname === `${BASE_PATH}/auth/oidc/callback`
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function main() {
  const httpServer = createServer();
  const app = next({ dev, dir: appDir, port, hostname: "localhost", httpServer });
  const handle = app.getRequestHandler();
  startMarkdownBridge();
  const collab = await createCollab();
  const robots = createRobots();
  await app.prepare();

  httpServer.on("request", (req, res) => {
    void (async () => {
      // For anything that answers, the refusal below included.
      applySecurityHeaders(res);
      const pathname = pathnameOf(req);
      // A network that may not use the site at all (lib/network-policy.ts):
      // refused before the app.
      if (!exemptFromNetworkPolicy(pathname) && !(await collab.networkCaps(req)).access) {
        const { title, message } = await collab.networkDenied(req);
        if (pathname.startsWith(`${BASE_PATH}/api/`)) {
          res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: { code: "network_denied", message: "Access from this network isn't allowed." } }));
        } else {
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(
            `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>` +
              `<main style="font-family:sans-serif;max-width:480px;margin:64px auto;padding:0 16px"><h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`,
          );
        }
        return;
      }
      // Search engines kept out unless allowed in /admin (server/robots.ts).
      await robots.apply(res).catch(() => {});
      await handle(req, res);
    })().catch((err) => {
      console.error("[server] request failed", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  // Next.js attaches its own "upgrade" listener on the first request and
  // serves its dev HMR socket under /_next/. It leaves sockets for any other
  // path untouched (so never add a page or route at /collab) — which also
  // means nobody would close them, so drop those here.
  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = pathnameOf(req);
    if (pathname !== COLLAB_PATH) {
      if (!pathname.startsWith(`${BASE_PATH}/_next/`)) socket.destroy();
      return;
    }
    void (async () => {
      // Refused like any request from a network that may not use the site.
      if (!(await collab.networkCaps(req)).access) {
        socket.destroy();
        return;
      }
      await collab.handleUpgrade(req, socket, head);
    })().catch((err) => {
      console.error("[collab] upgrade failed", err);
      socket.destroy();
    });
  });

  httpServer.listen(port, () => {
    console.log(`> knowlective ready on http://localhost:${port}${BASE_PATH} (${dev ? "development" : "production"})`);
    console.log(`> collaboration WebSocket at ws://localhost:${port}${COLLAB_PATH}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`> ${signal} received, saving open documents…`);
    httpServer.close();
    try {
      await collab.shutdown();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
