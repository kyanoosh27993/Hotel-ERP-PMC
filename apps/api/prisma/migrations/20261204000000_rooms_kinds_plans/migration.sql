-- نسخهٔ ۳٫۴ — مدیریت انواع اتاق + پلان تور/شرکت (درخواست کارفرما، طبق فرم‌های مرجع)
-- الف) انواع اتاق: نرخ‌های ۴گانهٔ ریالی/دلاری + فصلی + تخت اضافه
ALTER TABLE "room_types" ADD COLUMN "nameLatin" TEXT;
ALTER TABLE "room_types" ADD COLUMN "bedCount" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "room_types" ADD COLUMN "rateSingleRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateDoubleRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateTripleRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateFullRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateSingleUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateDoubleUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateTripleUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "rateFullUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "ratePeak1Rials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "ratePeak2Rials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "ratePeak3Rials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "fullBoardRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "extraBedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "extraBedRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "room_types" ADD COLUMN "pictureUrl" TEXT;
ALTER TABLE "room_types" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "room_types" ADD COLUMN "syncCode" INTEGER NOT NULL DEFAULT 0;

-- ب) اتاق فیزیکی: فیلدهای فرم «تصحیح مشخصات اتاق»
ALTER TABLE "rooms" ADD COLUMN "nameFa" TEXT;
ALTER TABLE "rooms" ADD COLUMN "nameLatin" TEXT;
ALTER TABLE "rooms" ADD COLUMN "bedCount" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "rooms" ADD COLUMN "orderInFloor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "extraBeds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateSingleRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateDoubleRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateTripleRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateFullRials" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateSingleUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateDoubleUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateTripleUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "rateFullUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "saleBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rooms" ADD COLUMN "guestRequests" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN "registerNo" INTEGER;
ALTER TABLE "rooms" ADD COLUMN "lastChargeAt" TIMESTAMP(3);
ALTER TABLE "rooms" ADD COLUMN "outOfServiceFrom" TIMESTAMP(3);
ALTER TABLE "rooms" ADD COLUMN "outOfServiceCancelAt" TIMESTAMP(3);
ALTER TABLE "rooms" ADD COLUMN "blockCard" TEXT;
ALTER TABLE "rooms" ADD COLUMN "tourCompany" TEXT;

-- ج) مشخصه‌های اضافی اتاق (چند‌به‌چند)
CREATE TABLE "room_amenities" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL UNIQUE,
  "nameFa" TEXT NOT NULL,
  "nameLatin" TEXT,
  "shortName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE "room_amenity_links" (
  "roomId" UUID NOT NULL,
  "amenityId" UUID NOT NULL,
  PRIMARY KEY ("roomId", "amenityId"),
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE,
  FOREIGN KEY ("amenityId") REFERENCES "room_amenities"("id") ON DELETE CASCADE
);

-- د) پلان تور/شرکت: کدینگ درآمدی + پلان + قلم پلان (سهم میهمان/شرکت)
CREATE TABLE "revenue_codes" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" INTEGER NOT NULL UNIQUE,
  "nameFa" TEXT NOT NULL,
  "nameEn" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE "plans" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" INTEGER NOT NULL UNIQUE,
  "nameFa" TEXT NOT NULL,
  "nameLatin" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "plan_items" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "planId" UUID NOT NULL,
  "revenueCodeId" UUID NOT NULL,
  "chargeTo" TEXT NOT NULL DEFAULT 'GUEST',
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("planId", "revenueCodeId"),
  FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE,
  FOREIGN KEY ("revenueCodeId") REFERENCES "revenue_codes"("id") ON DELETE RESTRICT
);

-- هـ) اتصال پلان به رزرو/اقامت و مسیر صورت‌حساب اقلام فولیو
ALTER TABLE "reservations" ADD COLUMN "planId" UUID REFERENCES "plans"("id") ON DELETE SET NULL;
ALTER TABLE "stays" ADD COLUMN "planId" UUID REFERENCES "plans"("id") ON DELETE SET NULL;
ALTER TABLE "folio_items" ADD COLUMN "revenueCodeId" UUID REFERENCES "revenue_codes"("id");
ALTER TABLE "folio_items" ADD COLUMN "chargeTo" TEXT;
