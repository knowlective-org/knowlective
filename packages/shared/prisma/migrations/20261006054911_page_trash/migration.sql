-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "deletedById" TEXT;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
