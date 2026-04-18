-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BOUNTY_CREATED', 'BOUNTY_CLAIMED', 'BOUNTY_REFUNDED', 'BOUNTY_REVOKED', 'BOUNTY_CANCELLED');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "bountyId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_walletAddress_idx" ON "Transaction"("walletAddress");

-- CreateIndex
CREATE INDEX "Transaction_bountyId_idx" ON "Transaction"("bountyId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
