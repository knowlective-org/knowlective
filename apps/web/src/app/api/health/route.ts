import { connection } from "next/server";
import { prisma } from "@/lib/db";

// Liveness/readiness for Docker's HEALTHCHECK and reverse proxies: 200 when
// the app can reach the database. Says nothing else about the instance.
// auth: public — health check for the container and the proxy; no data.
export async function GET() {
  await connection();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
