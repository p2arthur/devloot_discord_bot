-- AlterTable: Change amount from Float (double precision) to Int (integer)
-- Context: Contract stores microAlgos as uint64. API accepts ALGO and converts
-- to microAlgos before storing. All existing float values treated as microAlgos.
ALTER TABLE "Bounty" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount")::INTEGER;
