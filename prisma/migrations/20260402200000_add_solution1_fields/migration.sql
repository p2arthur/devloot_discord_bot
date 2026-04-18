-- Solution 1: State Machine Expansion
-- Add new bounty statuses and review/dispute fields

-- Add new enum values
ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW';
ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';
ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'PAID';

-- Add review window fields
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "review_until" TIMESTAMP(3);
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "winning_pr_url" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "winning_pr_author" TEXT;

-- Add fraud signal fields
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "risk_score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "risk_reasons" TEXT[];

-- Add AI review field
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "ai_summary" TEXT;

-- Add dispute tracking fields
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "dispute_reason" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "resolved_by" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "resolution_action" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "approved_early_at" TIMESTAMP(3);
