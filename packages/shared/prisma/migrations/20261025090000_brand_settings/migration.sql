-- CreateEnum
CREATE TYPE "BrandMode" AS ENUM ('TEXT', 'IMAGE');

-- CreateTable
CREATE TABLE "BrandSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" "BrandMode" NOT NULL DEFAULT 'TEXT',
    "name" TEXT NOT NULL DEFAULT 'KNOWLECTIVE',
    "logoSvg" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSettings_pkey" PRIMARY KEY ("id")
);
