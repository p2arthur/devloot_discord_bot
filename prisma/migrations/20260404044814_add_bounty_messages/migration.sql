-- CreateEnum
CREATE TYPE "BountyMessageType" AS ENUM ('CREATION', 'TOP_UP');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'BOUNTY_TOPPED_UP';

-- CreateTable
CREATE TABLE "BountyMessage" (
    "id" SERIAL NOT NULL,
    "bountyId" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "BountyMessageType" NOT NULL,
    "amount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BountyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BountyMessage_bountyId_idx" ON "BountyMessage"("bountyId");

-- CreateIndex
CREATE INDEX "BountyMessage_walletAddress_idx" ON "BountyMessage"("walletAddress");

-- AddForeignKey
ALTER TABLE "BountyMessage" ADD CONSTRAINT "BountyMessage_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
