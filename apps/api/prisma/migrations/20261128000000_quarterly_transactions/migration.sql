-- فاز ۹ / F9-T4: معاملات فصلی خارج از سامانه + فایل استاندارد اداره دارایی

CREATE TABLE IF NOT EXISTS "quarterly_periods" (
    "id"                 UUID           NOT NULL DEFAULT gen_random_uuid(),
    "taxYear"            INTEGER        NOT NULL,
    "quarter"            INTEGER        NOT NULL,
    "status"             TEXT           NOT NULL DEFAULT 'OPEN',
    "workflowInstanceId" UUID,
    "closedAt"           TIMESTAMPTZ(3),
    "closedById"         UUID,
    "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quarterly_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quarterly_periods_taxYear_quarter_key" UNIQUE ("taxYear", "quarter")
);

CREATE TABLE IF NOT EXISTS "quarterly_txs" (
    "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
    "periodId"         UUID           NOT NULL,
    "txType"           TEXT           NOT NULL,
    "counterpartyName" TEXT           NOT NULL,
    "counterpartyTin"  TEXT           NOT NULL DEFAULT '-',
    "amountRials"      BIGINT         NOT NULL,
    "vatRials"         BIGINT         NOT NULL,
    "txDate"           TIMESTAMPTZ(3) NOT NULL,
    "exempt"           BOOLEAN        NOT NULL DEFAULT false,
    "sourceType"       TEXT           NOT NULL DEFAULT 'MANUAL',
    "docRef"           TEXT           NOT NULL,
    "notes"            TEXT           NOT NULL DEFAULT '',
    "registeredById"   UUID,
    "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quarterly_txs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "quarterly_txs_periodId_txType_idx" ON "quarterly_txs" ("periodId", "txType");
