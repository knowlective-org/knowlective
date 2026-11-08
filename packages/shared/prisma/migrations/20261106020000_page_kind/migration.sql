-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('DOCUMENT', 'WHITEBOARD');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "kind" "PageKind" NOT NULL DEFAULT 'DOCUMENT';
