-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('WAITING', 'CONVERTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "checkedOutAt" TIMESTAMP(3),
ADD COLUMN     "ratePerNightRials" BIGINT,
ADD COLUMN     "roomId" UUID,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'PHONE',
ADD COLUMN     "units" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guestName" TEXT NOT NULL,
    "phone" TEXT,
    "roomTypeId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "status" "waitlist_status" NOT NULL DEFAULT 'WAITING',
    "convertedReservationId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_entries_status_fromDate_toDate_idx" ON "waitlist_entries"("status", "fromDate", "toDate");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
