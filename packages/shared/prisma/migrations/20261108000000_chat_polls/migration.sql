-- CreateTable
CREATE TABLE "ChatPoll" (
    "messageId" TEXT NOT NULL,
    "multiple" BOOLEAN NOT NULL,
    "optionsEnc" BYTEA NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ChatPoll_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "ChatPollVote" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPollVote_pkey" PRIMARY KEY ("messageId","userId","option")
);

-- AddForeignKey
ALTER TABLE "ChatPoll" ADD CONSTRAINT "ChatPoll_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatPollVote" ADD CONSTRAINT "ChatPollVote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatPoll"("messageId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatPollVote" ADD CONSTRAINT "ChatPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
