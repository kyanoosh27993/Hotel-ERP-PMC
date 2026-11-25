-- نیاز یکتایی کارفرما: ثبت مرکزی اشخاص و شرکت‌ها (مهمان / فروشنده / طرف حساب)
-- هر شخص/شرکت فقط یک بار در کل برنامه؛ ثبت دوباره ممنوع و فقط اصلاح رکورد قبلی.
DO $$ BEGIN
  CREATE TYPE "party_kind" AS ENUM ('GUEST', 'SUPPLIER', 'COUNTERPARTY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "party_kind" NOT NULL DEFAULT 'OTHER',
    "firstName" VARCHAR(120),
    "lastName" VARCHAR(120),
    "companyName" VARCHAR(160),
    "nationalId" VARCHAR(20),
    "idDocNo" VARCHAR(40),
    "natIdentifier" VARCHAR(20),
    "economicCode" VARCHAR(20),
    "mobile" VARCHAR(20),
    "phone" VARCHAR(20),
    "postalCode" VARCHAR(20),
    "address" TEXT,
    "email" VARCHAR(160),
    "nationality" VARCHAR(10),
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "parties_lastName_idx" ON "parties"("lastName");
CREATE INDEX IF NOT EXISTS "parties_firstName_idx" ON "parties"("firstName");
CREATE INDEX IF NOT EXISTS "parties_companyName_idx" ON "parties"("companyName");
CREATE INDEX IF NOT EXISTS "parties_nationalId_idx" ON "parties"("nationalId");
CREATE INDEX IF NOT EXISTS "parties_natIdentifier_idx" ON "parties"("natIdentifier");
CREATE INDEX IF NOT EXISTS "parties_economicCode_idx" ON "parties"("economicCode");
CREATE INDEX IF NOT EXISTS "parties_mobile_idx" ON "parties"("mobile");
CREATE INDEX IF NOT EXISTS "parties_postalCode_idx" ON "parties"("postalCode");
CREATE INDEX IF NOT EXISTS "parties_kind_idx" ON "parties"("kind");

-- پیوند فروشنده با ثبت یکتا
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "partyId" UUID;
CREATE INDEX IF NOT EXISTS "suppliers_partyId_idx" ON "suppliers"("partyId");

-- پیوند رزرو با ثبت یکتا — گیت هویتی در گذار رزرو→اقامت (الزام فیلدها هنگام چک‌این)
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "partyId" UUID;
CREATE INDEX IF NOT EXISTS "reservations_partyId_idx" ON "reservations"("partyId");
