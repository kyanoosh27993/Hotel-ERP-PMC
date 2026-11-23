-- فاز ۹ / F9-T2: ادغام مؤدیان — صورتحساب الکترونیکی
-- توالی شماره صورتحساب + جدول moadian_invoices

CREATE SEQUENCE IF NOT EXISTS seq_invoice_number;

CREATE TABLE IF NOT EXISTS "moadian_invoices" (
    "id"              UUID            NOT NULL DEFAULT gen_random_uuid(),
    "invoiceNumber"   TEXT            NOT NULL,
    "journalEntryId"  UUID            NOT NULL,
    "sellerTaxId"     TEXT            NOT NULL,
    "buyerTaxId"      TEXT            NOT NULL DEFAULT '',
    "buyerName"       TEXT            NOT NULL DEFAULT '',
    "issueDate"       DATE            NOT NULL,
    "status"          TEXT            NOT NULL DEFAULT 'DRAFT',
    "header"          JSONB           NOT NULL DEFAULT '{}'::jsonb,
    "body"            JSONB           NOT NULL DEFAULT '[]'::jsonb,
    "totalRials"      BIGINT          NOT NULL DEFAULT 0,
    "vatRials"        BIGINT          NOT NULL DEFAULT 0,
    "discountRials"   BIGINT          NOT NULL DEFAULT 0,
    "uid"             TEXT,
    "idempotencyKey"  TEXT            NOT NULL,
    "attempts"        INTEGER         NOT NULL DEFAULT 0,
    "lastError"       TEXT,
    "lastResponse"    JSONB,
    "submittedAt"     TIMESTAMPTZ(3),
    "cancelledAt"     TIMESTAMPTZ(3),
    "cancelReason"    TEXT,
    "createdAt"       TIMESTAMPTZ(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(3)  NOT NULL,

    CONSTRAINT "moadian_invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moadian_invoices_invoiceNumber_key" UNIQUE ("invoiceNumber"),
    CONSTRAINT "moadian_invoices_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX IF NOT EXISTS "moadian_invoices_status_issueDate_idx"
    ON "moadian_invoices" ("status", "issueDate");
CREATE INDEX IF NOT EXISTS "moadian_invoices_journalEntryId_idx"
    ON "moadian_invoices" ("journalEntryId");
