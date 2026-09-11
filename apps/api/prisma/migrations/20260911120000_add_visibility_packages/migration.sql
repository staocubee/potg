-- CreateTable
CREATE TABLE "visibility_packages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "boostWeight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visibility_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_subscriptions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerReference" TEXT,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visibility_packages_code_key" ON "visibility_packages"("code");

-- CreateIndex
CREATE INDEX "package_subscriptions_accountId_idx" ON "package_subscriptions"("accountId");

-- AddForeignKey
ALTER TABLE "package_subscriptions" ADD CONSTRAINT "package_subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_subscriptions" ADD CONSTRAINT "package_subscriptions_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "visibility_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
