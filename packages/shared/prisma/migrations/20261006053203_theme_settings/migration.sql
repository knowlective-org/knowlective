-- CreateTable
CREATE TABLE "ThemeSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "colors" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeSettings_pkey" PRIMARY KEY ("id")
);
