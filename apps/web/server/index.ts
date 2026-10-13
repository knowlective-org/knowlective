// Must stay first: sets NODE_ENV and loads .env before anything else.
import { appDir, dev } from "./env";
import { createServer, type IncomingMessage } from "node:http";
import next from "next";
import { BASE_PATH } from "../src/lib/base-path";
import { COLLAB_PATH, createCollab } from "./collab";

// One process, one port: the Next.js app (pages, Server Actions) and the
// collaboration WebSocket at /collab (both under YOSUGA_BASE_PATH, if set). Runs via tsx because packages/shared is
// consumed as TypeScript source.
//   pnpm dev    → tsx watch server/index.ts
//   pnpm start  → tsx server/index.ts --prod   (after `pnpm build`)

const port = Number(process.env.PORT ?? 3000);

function pathnameOf(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

async function main() {
  const httpServer = createServer();
  const app = next({ dev, dir: appDir, port, hostname: "localhost", httpServer });
  const handle = app.getRequestHandler();
  const collab = await createCollab();
  await app.prepare();

  httpServer.on("request", (req, res) => {
    handle(req, res);
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
    collab.handleUpgrade(req, socket, head).catch((err) => {
      console.error("[collab] upgrade failed", err);
      socket.destroy();
    });
  });

  httpServer.listen(port, () => {
    console.log(`> yosuga ready on http://localhost:${port}${BASE_PATH} (${dev ? "development" : "production"})`);
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
