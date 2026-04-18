-- Add onboarded column to User (if not already present)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'User' AND column_name = 'onboarded'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "onboarded" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Drop and recreate QuestCompletion to match Prisma schema
-- (changing userId from INTEGER FK to TEXT Discord ID, completedAt -> date)
DROP TABLE IF EXISTS "QuestCompletion" CASCADE;

CREATE TABLE "QuestCompletion" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "questType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuestCompletion_userId_questType_date_key" ON "QuestCompletion"("userId", "questType", "date");
CREATE INDEX IF NOT EXISTS "QuestCompletion_userId_date_idx" ON "QuestCompletion"("userId", "date");
