-- مهاجرت فاز ۷ (موج ۲) — انبار، خرید، تدارکات و کاست کنترل (نقشه ۷.۵/۷.۶)

-- CreateEnum
CREATE TYPE "movement_direction" AS ENUM ('IN', 'OUT', 'ADJUST_IN', 'ADJUST_OUT', 'WASTE');

-- CreateEnum
CREATE TYPE "requisition_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONVERTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "po_status" AS ENUM ('DRAFT', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "count_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "unitPurchase" TEXT NOT NULL DEFAULT 'عدد',
    "unitConsumption" TEXT NOT NULL DEFAULT 'عدد',
    "conversionFactor" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "minQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "qtyOnHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "avgCostRials" BIGINT NOT NULL DEFAULT 0,
    "warehouseId" UUID,
    "allowNegative" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stockItemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "direction" "movement_direction" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCostRials" BIGINT NOT NULL,
    "valueRials" BIGINT NOT NULL,
    "refModule" TEXT NOT NULL,
    "refId" TEXT,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "phone" TEXT,
    "ledgerCode" TEXT NOT NULL DEFAULT '2101',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reqNo" TEXT NOT NULL,
    "status" "requisition_status" NOT NULL DEFAULT 'DRAFT',
    "requestedById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reqId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "purchase_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poNo" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "requisitionId" UUID,
    "status" "po_status" NOT NULL DEFAULT 'DRAFT',
    "subtotalRials" BIGINT NOT NULL DEFAULT 0,
    "taxRials" BIGINT NOT NULL DEFAULT 0,
    "totalRials" BIGINT NOT NULL DEFAULT 0,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "qtyOrdered" DECIMAL(12,3) NOT NULL,
    "qtyReceived" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unitCostRials" BIGINT NOT NULL,
    "taxRateBps" INTEGER NOT NULL DEFAULT 900,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grnNo" TEXT NOT NULL,
    "poId" UUID NOT NULL,
    "receivedById" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grnId" UUID NOT NULL,
    "poLineId" UUID NOT NULL,
    "qtyReceived" DECIMAL(12,3) NOT NULL,
    "unitCostRials" BIGINT NOT NULL,
    "expiryDate" DATE,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "countNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "count_status" NOT NULL DEFAULT 'OPEN',
    "countedById" UUID,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" UUID,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "countId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "qtySystem" DECIMAL(12,3) NOT NULL,
    "qtyCounted" DECIMAL(12,3) NOT NULL,
    "varianceQty" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_code_key" ON "stock_items"("code");

-- CreateIndex
CREATE INDEX "stock_items_qtyOnHand_minQty_idx" ON "stock_items"("qtyOnHand", "minQty");

-- CreateIndex
CREATE INDEX "stock_movements_stockItemId_createdAt_idx" ON "stock_movements"("stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_refModule_refId_idx" ON "stock_movements"("refModule", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_reqNo_key" ON "purchase_requisitions"("reqNo");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_poNo_key" ON "purchase_orders"("poNo");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_status_idx" ON "purchase_orders"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_grnNo_key" ON "goods_receipts"("grnNo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_countNo_key" ON "stock_counts"("countNo");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_countId_stockItemId_key" ON "stock_count_lines"("countId", "stockItemId");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_reqId_fkey" FOREIGN KEY ("reqId") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
