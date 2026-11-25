-- CreateTable
CREATE TABLE "UsageDaily" (
    "day" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "count" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("day","userId","channel","metric","via","detail")
);

-- CreateIndex
CREATE INDEX "UsageDaily_userId_day_idx" ON "UsageDaily"("userId", "day");

-- AddForeignKey
ALTER TABLE "UsageDaily" ADD CONSTRAINT "UsageDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
