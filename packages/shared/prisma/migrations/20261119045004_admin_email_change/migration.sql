-- CreateTable
CREATE TABLE "AdminEmailChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT,
    "newEmailHash" BYTEA NOT NULL,
    "newEmailEnc" BYTEA NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sends" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminEmailChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminEmailChange_userId_key" ON "AdminEmailChange"("userId");

-- AddForeignKey
ALTER TABLE "AdminEmailChange" ADD CONSTRAINT "AdminEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
