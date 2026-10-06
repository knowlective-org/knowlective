-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('TEXT', 'DATE', 'USER', 'SELECT');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "updatedById" TEXT;

-- CreateTable
CREATE TABLE "PagePropertyDef" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "type" "PropertyType" NOT NULL,
    "name" BYTEA NOT NULL,
    "options" BYTEA,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagePropertyDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagePropertyValue" (
    "pageId" TEXT NOT NULL,
    "defId" TEXT NOT NULL,
    "value" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagePropertyValue_pkey" PRIMARY KEY ("pageId","defId")
);

-- CreateIndex
CREATE INDEX "PagePropertyDef_pageId_idx" ON "PagePropertyDef"("pageId");

-- CreateIndex
CREATE INDEX "PagePropertyValue_defId_idx" ON "PagePropertyValue"("defId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagePropertyDef" ADD CONSTRAINT "PagePropertyDef_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagePropertyValue" ADD CONSTRAINT "PagePropertyValue_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagePropertyValue" ADD CONSTRAINT "PagePropertyValue_defId_fkey" FOREIGN KEY ("defId") REFERENCES "PagePropertyDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
