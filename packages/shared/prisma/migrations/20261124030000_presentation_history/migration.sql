-- A presentation's history (what it was made of at a moment) and its slides'
-- speaker notes. Both are encrypted with the data key by the app.
CREATE TABLE "PresentationSnapshot" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "sealed" BYTEA NOT NULL,

    CONSTRAINT "PresentationSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PresentationSnapshot_pageId_createdAt_idx" ON "PresentationSnapshot"("pageId", "createdAt");

ALTER TABLE "PresentationSnapshot" ADD CONSTRAINT "PresentationSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SlideNote" (
    "slideId" TEXT NOT NULL,
    "textEnc" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SlideNote_pkey" PRIMARY KEY ("slideId")
);

ALTER TABLE "SlideNote" ADD CONSTRAINT "SlideNote_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
