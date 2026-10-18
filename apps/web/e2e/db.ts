import path from "node:path";
import { type PrismaClient, createPrismaClient, emailHash, loadDataKey } from "shared";

// The development database, for what a test can't do through the screens
// (DATABASE_URL, from the root .env).

if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(__dirname, "../../../.env"));

export async function withPrisma<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = createPrismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

export async function userWhere(prisma: PrismaClient, email: string) {
  return { emailHash: emailHash(await loadDataKey(prisma), email) };
}

// Forgets the page the user opened last, as for someone who just signed up.
export async function clearLastPage(email: string) {
  await withPrisma(async (prisma) => {
    await prisma.user.update({ where: await userWhere(prisma, email), data: { lastPageId: null } });
  });
}
