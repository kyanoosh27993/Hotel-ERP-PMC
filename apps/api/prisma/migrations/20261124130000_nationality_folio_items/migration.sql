-- ملیت مهمان در رزرو — تفکیک ایرانی/خارجی + گزارش (درخواست کارفرما)
ALTER TABLE "reservations" ADD COLUMN "nationality" TEXT;

-- اقلام اضافی فولیو اقامت — چارج اتاق (Room Additional Items — مرجع آسا 4.zip)
CREATE TABLE "folio_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stayId" UUID NOT NULL,
    "desc" VARCHAR(120) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitRials" BIGINT NOT NULL DEFAULT 0,
    "totalRials" BIGINT NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "folio_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "folio_items_stayId_idx" ON "folio_items"("stayId");

ALTER TABLE "folio_items" ADD CONSTRAINT "folio_items_stayId_fkey"
  FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "folio_items" ADD CONSTRAINT "folio_items_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
