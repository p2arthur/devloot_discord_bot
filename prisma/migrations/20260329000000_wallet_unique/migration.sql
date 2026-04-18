-- Add unique constraint to User.wallet
-- Safe because wallet is nullable — multiple NULLs are allowed under unique constraint in PostgreSQL
CREATE UNIQUE INDEX IF NOT EXISTS "User_wallet_key" ON "User"("wallet");
