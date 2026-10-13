-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "lockSubtree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
