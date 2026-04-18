/*
  Warnings:

  - A unique constraint covering the columns `[bounty_key]` on the table `Bounty` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `bounty_key` to the `Bounty` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Bounty" ADD COLUMN     "bounty_key" BYTEA NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Bounty_bounty_key_key" ON "Bounty"("bounty_key");
