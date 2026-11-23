-- Presentation pages: a parent page with one child page per slide.
ALTER TYPE "PageKind" ADD VALUE 'PRESENTATION';
ALTER TYPE "PageKind" ADD VALUE 'SLIDE';

CREATE TABLE "PresentationSettings" (
    "pageId" TEXT NOT NULL,
    "numberingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "numberStart" INTEGER NOT NULL DEFAULT 1,
    "numberPosition" TEXT NOT NULL DEFAULT 'right',
    "hiddenSlideIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numberHiddenSlideIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresentationSettings_pkey" PRIMARY KEY ("pageId")
);

ALTER TABLE "PresentationSettings" ADD CONSTRAINT "PresentationSettings_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
