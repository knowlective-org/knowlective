-- AlterTable
ALTER TABLE "KnowledgeRoot" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRoot_ownerId_key" ON "KnowledgeRoot"("ownerId");

-- AddForeignKey
ALTER TABLE "KnowledgeRoot" ADD CONSTRAINT "KnowledgeRoot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;