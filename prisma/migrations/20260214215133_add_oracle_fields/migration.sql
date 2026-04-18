-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BountyStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "BountyStatus" ADD VALUE 'REFUNDABLE';

-- AlterTable
ALTER TABLE "Bounty" ADD COLUMN     "closed_by_commit_id" TEXT,
ADD COLUMN     "last_checked_at" TIMESTAMP(3),
ADD COLUMN     "processed_event_id" BIGINT,
ADD COLUMN     "state_reason" TEXT;
