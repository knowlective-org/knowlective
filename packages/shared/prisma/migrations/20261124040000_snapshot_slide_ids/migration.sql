-- Which slides a presentation snapshot holds, to find them when masking.
ALTER TABLE "PresentationSnapshot" ADD COLUMN "slideIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "PresentationSnapshot_slideIds_idx" ON "PresentationSnapshot" USING GIN ("slideIds");
