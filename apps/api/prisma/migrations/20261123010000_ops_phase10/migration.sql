-- مهاجرت فاز ۱۰ — خانه‌داری، لاندری، تعمیرات، دارایی ثابت، خدمات جانبی (نقشه ۷.۴/۷.۸/۷.۱۰)

-- CreateEnum
CREATE TYPE "room_task_kind" AS ENUM ('CLEANING', 'TURNDOWN', 'INSPECTION', 'MAINTENANCE_FOLLOWUP');

-- CreateEnum
CREATE TYPE "room_task_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "maintenance_status" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "laundry_direction" AS ENUM ('OUT_WASH', 'IN_RETURN');

-- CreateEnum
CREATE TYPE "laundry_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "lost_found_status" AS ENUM ('STORED', 'RETURNED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "depreciation_method" AS ENUM ('STRAIGHT_LINE');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('ACTIVE', 'TRANSFERRED', 'SOLD', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "ancillary_category" AS ENUM ('PHONE', 'PARKING', 'TAXI', 'POOL', 'INTERNET', 'SHOP', 'CEREMONY', 'OTHER');

-- CreateEnum
CREATE TYPE "ancillary_order_status" AS ENUM ('CONFIRMED', 'CHARGED', 'CANCELED');

-- CreateTable
CREATE TABLE "room_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roomId" UUID NOT NULL,
    "kind" "room_task_kind" NOT NULL,
    "status" "room_task_status" NOT NULL DEFAULT 'PENDING',
    "priority" "task_priority" NOT NULL DEFAULT 'NORMAL',
    "assigneeId" UUID,
    "scheduledDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_inspections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roomId" UUID NOT NULL,
    "taskId" UUID,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER,
    "issuesJson" JSONB,
    "inspectedById" UUID,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requestNo" TEXT NOT NULL,
    "roomId" UUID,
    "assetId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "task_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "maintenance_status" NOT NULL DEFAULT 'OPEN',
    "reportedById" UUID,
    "assigneeId" UUID,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "costRials" BIGINT,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linen_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'عدد',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "linen_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laundry_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "direction" "laundry_direction" NOT NULL,
    "status" "laundry_status" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openedById" UUID,

    CONSTRAINT "laundry_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laundry_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batchId" UUID NOT NULL,
    "linenItemId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "recordedById" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "laundry_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_and_founds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "roomId" UUID NOT NULL,
    "itemDesc" TEXT NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageLocation" TEXT NOT NULL,
    "status" "lost_found_status" NOT NULL DEFAULT 'STORED',
    "returnedTo" TEXT,
    "returnedAt" TIMESTAMP(3),
    "note" TEXT,
    "foundById" UUID,

    CONSTRAINT "lost_and_founds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assetCode" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "acquiredAt" DATE NOT NULL,
    "costRials" BIGINT NOT NULL,
    "salvageRials" BIGINT NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" "depreciation_method" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "glAssetAccountCode" TEXT NOT NULL,
    "glAccDepAccountCode" TEXT NOT NULL,
    "glDepExpenseAccountCode" TEXT NOT NULL,
    "roomId" UUID,
    "status" "asset_status" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assetId" UUID NOT NULL,
    "periodCode" TEXT NOT NULL,
    "amountRials" BIGINT NOT NULL,
    "accumulatedRials" BIGINT NOT NULL,
    "journalEntryNo" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ancillary_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "category" "ancillary_category" NOT NULL,
    "unitPriceRials" BIGINT NOT NULL,
    "taxRateBps" INTEGER NOT NULL DEFAULT 900,
    "glRevenueAccountCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ancillary_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ancillary_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderNo" TEXT NOT NULL,
    "serviceId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceRials" BIGINT NOT NULL,
    "netRials" BIGINT NOT NULL,
    "taxRials" BIGINT NOT NULL,
    "totalRials" BIGINT NOT NULL,
    "stayId" UUID,
    "guestName" TEXT,
    "status" "ancillary_order_status" NOT NULL DEFAULT 'CONFIRMED',
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedById" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "ancillary_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_tasks_roomId_status_idx" ON "room_tasks"("roomId", "status");

-- CreateIndex
CREATE INDEX "room_tasks_scheduledDate_status_idx" ON "room_tasks"("scheduledDate", "status");

-- CreateIndex
CREATE INDEX "room_inspections_roomId_inspectedAt_idx" ON "room_inspections"("roomId", "inspectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_requestNo_key" ON "maintenance_requests"("requestNo");

-- CreateIndex
CREATE INDEX "maintenance_requests_status_priority_idx" ON "maintenance_requests"("status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "linen_items_code_key" ON "linen_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "laundry_batches_code_key" ON "laundry_batches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "laundry_movements_batchId_linenItemId_key" ON "laundry_movements"("batchId", "linenItemId");

-- CreateIndex
CREATE UNIQUE INDEX "lost_and_founds_code_key" ON "lost_and_founds"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_assetCode_key" ON "fixed_assets"("assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_assetId_periodCode_key" ON "asset_depreciations"("assetId", "periodCode");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_idempotencyKey_key" ON "asset_depreciations"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ancillary_services_code_key" ON "ancillary_services"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ancillary_orders_orderNo_key" ON "ancillary_orders"("orderNo");

-- CreateIndex
CREATE INDEX "ancillary_orders_serviceId_servedAt_idx" ON "ancillary_orders"("serviceId", "servedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ancillary_orders_idempotencyKey_key" ON "ancillary_orders"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "room_tasks" ADD CONSTRAINT "room_tasks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_inspections" ADD CONSTRAINT "room_inspections_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laundry_movements" ADD CONSTRAINT "laundry_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "laundry_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laundry_movements" ADD CONSTRAINT "laundry_movements_linenItemId_fkey" FOREIGN KEY ("linenItemId") REFERENCES "linen_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_and_founds" ADD CONSTRAINT "lost_and_founds_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ancillary_orders" ADD CONSTRAINT "ancillary_orders_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ancillary_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ancillary_orders" ADD CONSTRAINT "ancillary_orders_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;
