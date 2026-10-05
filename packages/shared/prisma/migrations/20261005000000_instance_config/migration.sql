-- CreateTable
CREATE TABLE "InstanceConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "kdfSalt" BYTEA NOT NULL,
    "kdfParams" JSONB NOT NULL,
    "dekByPassword" BYTEA NOT NULL,
    "dekByServerKey" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceConfig_pkey" PRIMARY KEY ("id"),
    -- Singleton: only one instance configuration may ever exist.
    CONSTRAINT "InstanceConfig_singleton" CHECK ("id" = 1)
);
