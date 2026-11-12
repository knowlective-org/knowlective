-- AlterTable
ALTER TABLE "KnowledgeRoot" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;
