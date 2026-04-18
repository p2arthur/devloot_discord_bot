-- Drop old tables that have mismatched schemas
DROP TABLE IF EXISTS "ProposalVote" CASCADE;
DROP TABLE IF EXISTS "Proposal" CASCADE;
DROP TABLE IF EXISTS "DailyStreak" CASCADE;
DROP TYPE IF EXISTS "ProposalStatus";

-- Recreate Proposal with correct schema
CREATE TABLE "Proposal" (
    "id" SERIAL NOT NULL,
    "issueUrl" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposerId" TEXT NOT NULL,
    "aiAnalysis" TEXT,
    "aiCachedAt" TIMESTAMP(3),
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "threadCreated" BOOLEAN NOT NULL DEFAULT false,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Proposal_issueUrl_key" ON "Proposal"("issueUrl");
CREATE INDEX "Proposal_owner_repo_issueNumber_idx" ON "Proposal"("owner", "repo", "issueNumber");
CREATE INDEX "Proposal_createdAt_idx" ON "Proposal"("createdAt");

-- Recreate ProposalVote with correct schema
CREATE TABLE "ProposalVote" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProposalVote_proposalId_userId_key" ON "ProposalVote"("proposalId", "userId");

ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate DailyStreak with correct schema (Discord userId as PK, no FK to User)
CREATE TABLE "DailyStreak" (
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastClaimDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStreak_pkey" PRIMARY KEY ("userId")
);
