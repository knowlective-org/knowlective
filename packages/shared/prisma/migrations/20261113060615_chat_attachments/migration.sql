-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
