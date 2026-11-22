-- CreateEnum
CREATE TYPE "housekeeping_status" AS ENUM ('CLEAN', 'DIRTY', 'IN_PROGRESS', 'INSPECTED');

-- CreateEnum
CREATE TYPE "reservation_source" AS ENUM ('PHONE', 'WALK_IN', 'ONLINE', 'OTA');

-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('WAITING', 'OFFERED', 'BOOKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "stay_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "audit_status" AS ENUM ('OK', 'WITH_EXCEPTIONS');

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "adults" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "children" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" "reservation_source" NOT NULL DEFAULT 'PHONE';

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "hkStatus" "housekeeping_status" NOT NULL DEFAULT 'CLEAN',
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guestName" TEXT NOT NULL,
    "phone" TEXT,
    "roomTypeId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "status" "waitlist_status" NOT NULL DEFAULT 'WAITING',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "reservationId" UUID,
    "guestName" TEXT NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "status" "stay_status" NOT NULL DEFAULT 'OPEN',
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedCheckOut" DATE NOT NULL,
    "actualCheckOutAt" TIMESTAMP(3),
    "folioRials" BIGINT NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stayId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "rateOverrideRials" BIGINT,

    CONSTRAINT "stay_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "night_audit_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "businessDate" DATE NOT NULL,
    "status" "audit_status" NOT NULL DEFAULT 'OK',
    "openStays" INTEGER NOT NULL DEFAULT 0,
    "dirtyRooms" INTEGER NOT NULL DEFAULT 0,
    "arrivalsNotCheckedIn" INTEGER NOT NULL DEFAULT 0,
    "exceptions" JSONB NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" UUID,

    CONSTRAINT "night_audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_entries_status_fromDate_idx" ON "waitlist_entries"("status", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "stays_code_key" ON "stays"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stays_idempotencyKey_key" ON "stays"("idempotencyKey");

-- CreateIndex
CREATE INDEX "stays_status_plannedCheckOut_idx" ON "stays"("status", "plannedCheckOut");

-- CreateIndex
CREATE INDEX "stay_rooms_roomId_idx" ON "stay_rooms"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "stay_rooms_stayId_roomId_key" ON "stay_rooms"("stayId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "night_audit_runs_businessDate_key" ON "night_audit_runs"("businessDate");

-- CreateIndex
CREATE INDEX "rooms_status_hkStatus_idx" ON "rooms"("status", "hkStatus");

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stays" ADD CONSTRAINT "stays_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_rooms" ADD CONSTRAINT "stay_rooms_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_rooms" ADD CONSTRAINT "stay_rooms_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
