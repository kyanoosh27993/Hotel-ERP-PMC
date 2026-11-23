-- موج ۳ — فاز ۸ و ۹: سند ۱۴فیلدی (شماره عطف + پیوست‌ها)، بستن دوره،
-- مراکز هزینه، موتور نگاشت پارامتریک رویداد→سند، کتابخانه قوانین

-- ── F8-T1: شماره عطف اسناد + پیوست‌ها ──
CREATE SEQUENCE IF NOT EXISTS seq_journal_docindex;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "docIndex" BIGINT;
WITH numbered AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY "postingDate", "entryNo"))::bigint AS rn
  FROM journal_entries WHERE status IN ('POSTED', 'REVERSED')
)
UPDATE journal_entries SET "docIndex" = numbered.rn
FROM numbered WHERE journal_entries.id = numbered.id;
SELECT setval('seq_journal_docindex', GREATEST((SELECT COALESCE(MAX("docIndex"), 0) FROM journal_entries), 1));

CREATE TABLE IF NOT EXISTS "journal_attachments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entryId" UUID NOT NULL REFERENCES "journal_entries"(id),
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "dataRef" TEXT,
  "uploadedById" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jattach_entry ON "journal_attachments"("entryId");

-- ── F8-T3: بستن دوره + مراکز هزینه/سود ──
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ;
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS "closingEntryId" UUID;

CREATE TABLE IF NOT EXISTS "cost_centers" (
  "code" TEXT PRIMARY KEY,
  "nameFa" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'COST',
  "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "cost_centers" ("code","nameFa","nameEn","kind") VALUES
  ('CC-ROOM','اقامت','Rooms','PROFIT'),
  ('CC-FB','رستوران','Food & Beverage','PROFIT'),
  ('CC-ANC','خدمات جانبی','Ancillary','PROFIT'),
  ('CC-ADMIN','هتل/مدیریت','Administration','COST'),
  ('CC-HK','خانه‌داری','Housekeeping','COST')
ON CONFLICT ("code") DO NOTHING;

-- ── F8-T2: موتور نگاشت پارامتریک رویداد→سند ──
CREATE TABLE IF NOT EXISTS "event_journal_mappings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventName" TEXT NOT NULL UNIQUE,
  "amountField" TEXT NOT NULL DEFAULT 'amountRials',
  "debitAccount" TEXT NOT NULL,
  "creditAccount" TEXT NOT NULL,
  "descriptionTemplate" TEXT NOT NULL,
  "costCenterCode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── F9-T1: کتابخانه قوانین با متادیتای ۱۲گانه ──
CREATE TABLE IF NOT EXISTS "law_rules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "lawName" TEXT NOT NULL,
  "article" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "params" JSONB NOT NULL DEFAULT '{}',
  "testScenario" TEXT NOT NULL DEFAULT '',
  "legalOwner" TEXT NOT NULL DEFAULT '',
  "sourceRef" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- هم‌ترازی توالی شمارهٔ سند با شماره‌های قدیمی max+1 (پایگاه‌های ارتقایافته از موج‌های قبل)
SELECT setval('seq_journal', GREATEST(
  COALESCE((SELECT MAX((regexp_replace("entryNo", '^JV-\d+-', ''))::bigint) FROM journal_entries WHERE "entryNo" LIKE 'JV-%'), 1),
  (SELECT last_value FROM seq_journal)));
