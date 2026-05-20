-- Seat subscription fields + SeatTransfer.
-- Foundation for the Stripe-backed seat-licensing feature (PR A — Phase 0).
--
-- Append-only (rule 1): two new columns on Seat, one new table, two new
-- indexes, one FK. No existing tables renamed, no enum values changed.
--   isActive    DEFAULT true → existing seats stay usable; the Stripe webhook
--                              flips it to false on downgrade/cancel instead
--                              of hard-deleting (assignment history survives).
--   stripeSubId NULL         → seed/legacy seats have no Stripe origin.

-- AlterTable
ALTER TABLE "Seat"
  ADD COLUMN "isActive"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stripeSubId" TEXT;

-- CreateTable
CREATE TABLE "SeatTransfer" (
    "id" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "fromOrgUserId" TEXT,
    "toOrgUserId" TEXT,
    "reason" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Seat_orgId_stripeSubId_idx" ON "Seat"("orgId", "stripeSubId");

-- CreateIndex
CREATE INDEX "SeatTransfer_seatId_idx" ON "SeatTransfer"("seatId");

-- AddForeignKey
ALTER TABLE "SeatTransfer"
  ADD CONSTRAINT "SeatTransfer_seatId_fkey"
  FOREIGN KEY ("seatId") REFERENCES "Seat"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
