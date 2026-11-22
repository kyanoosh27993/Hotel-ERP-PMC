-- مهاجرت فاز ۶ (موج ۲) — رستوران، POS و آشپزخانه (نقشه ۷.۳)
-- PoC قبلی pos_orders دست‌نخورده می‌ماند.

-- CreateEnum
CREATE TYPE "table_status" AS ENUM ('FREE', 'OCCUPIED', 'RESERVED');

-- CreateEnum
CREATE TYPE "order_mode" AS ENUM ('DINE_IN', 'TAKEAWAY', 'ROOM_SERVICE');

-- CreateEnum
CREATE TYPE "restaurant_order_status" AS ENUM ('OPEN', 'SERVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "order_item_status" AS ENUM ('NEW', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "kitchen_ticket_status" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'SERVED');

-- CreateTable
CREATE TABLE "dining_areas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outletId" UUID NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,

    CONSTRAINT "dining_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "areaId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "status" "table_status" NOT NULL DEFAULT 'FREE',

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "yieldPortions" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipeId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "qtyPerPortion" DECIMAL(12,3) NOT NULL,
    "wasteFactorBps" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "categoryId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "priceRials" BIGINT NOT NULL,
    "taxRateBps" INTEGER NOT NULL DEFAULT 900,
    "recipeId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderNo" TEXT NOT NULL,
    "outletId" UUID NOT NULL,
    "areaId" UUID,
    "tableId" UUID,
    "mode" "order_mode" NOT NULL DEFAULT 'DINE_IN',
    "stayId" UUID,
    "guestName" TEXT,
    "status" "restaurant_order_status" NOT NULL DEFAULT 'OPEN',
    "discountRials" BIGINT NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "netRials" BIGINT NOT NULL DEFAULT 0,
    "taxRials" BIGINT NOT NULL DEFAULT 0,
    "totalRials" BIGINT NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "openedById" UUID,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceRials" BIGINT NOT NULL,
    "lineNetRials" BIGINT NOT NULL,
    "status" "order_item_status" NOT NULL DEFAULT 'NEW',
    "cancelReason" TEXT,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticketNo" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "kitchen_ticket_status" NOT NULL DEFAULT 'QUEUED',
    "tableLabel" TEXT,
    "itemsJson" JSONB NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),

    CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dining_tables_areaId_status_idx" ON "dining_tables"("areaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_code_key" ON "dining_tables"("code");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_code_key" ON "menu_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_code_key" ON "recipes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_recipeId_stockItemId_key" ON "recipe_lines"("recipeId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_code_key" ON "menu_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_orderNo_key" ON "restaurant_orders"("orderNo");

-- CreateIndex
CREATE INDEX "restaurant_orders_outletId_status_idx" ON "restaurant_orders"("outletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_idempotencyKey_key" ON "restaurant_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "order_items_orderId_status_idx" ON "order_items"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_tickets_ticketNo_key" ON "kitchen_tickets"("ticketNo");

-- CreateIndex
CREATE INDEX "kitchen_tickets_status_openedAt_idx" ON "kitchen_tickets"("status", "openedAt");

-- AddForeignKey
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "pos_outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "dining_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "pos_outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
