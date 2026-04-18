-- Make userId nullable on Notification (for wallet-only users with no GitHub account)
ALTER TABLE "Notification" ALTER COLUMN "userId" DROP NOT NULL;

-- Add walletAddress as fallback identifier
ALTER TABLE "Notification" ADD COLUMN "walletAddress" TEXT;

-- Add index for wallet-based notification queries
CREATE INDEX "Notification_walletAddress_idx" ON "Notification"("walletAddress");
