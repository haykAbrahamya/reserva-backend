-- Support chat (partner ⇄ platform): 1:1 thread per partner + messages,
-- plus a platform-staff web-push subscription table. Fully additive — new
-- enums/tables/indexes/FKs only; no existing table or data is altered.

-- CreateEnum
CREATE TYPE "SupportThreadStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "SupportSender" AS ENUM ('partner', 'platform');

-- CreateTable
CREATE TABLE "support_threads" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "SupportThreadStatus" NOT NULL DEFAULT 'open',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partnerUnread" INTEGER NOT NULL DEFAULT 0,
    "platformUnread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderType" "SupportSender" NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_threads_partnerId_key" ON "support_threads"("partnerId");

-- CreateIndex
CREATE INDEX "support_threads_status_lastMessageAt_idx" ON "support_threads"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "support_messages_threadId_createdAt_idx" ON "support_messages"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_push_subscriptions_endpoint_key" ON "platform_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "platform_push_subscriptions_userId_idx" ON "platform_push_subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_push_subscriptions" ADD CONSTRAINT "platform_push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

