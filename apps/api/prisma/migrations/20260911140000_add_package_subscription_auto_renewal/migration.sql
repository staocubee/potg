-- AlterTable
ALTER TABLE "package_subscriptions" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "package_subscriptions" ADD COLUMN "authorizationCode" TEXT;
ALTER TABLE "package_subscriptions" ADD COLUMN "payerEmail" TEXT;
ALTER TABLE "package_subscriptions" ADD COLUMN "renewedFromId" TEXT;

-- CreateIndex
CREATE INDEX "package_subscriptions_autoRenew_status_expiresAt_idx" ON "package_subscriptions"("autoRenew", "status", "expiresAt");
