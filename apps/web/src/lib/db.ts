import { createPrismaClient } from "shared";

// One PrismaClient per server process. In dev, module re-evaluation on HMR
// would otherwise open a new connection pool on every edit.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
