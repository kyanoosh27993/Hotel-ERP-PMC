-- فاز ۹ / F9-T5: مالیات مستقیم — برنامهٔ عملکرد، اظهارنامه عملکرد، شناسهٔ طرف‌های معامله

CREATE TABLE IF NOT EXISTS "direct_tax_plans" (
    "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
    "taxYear"       INTEGER        NOT NULL,
    "planJson"      JSONB          NOT NULL DEFAULT '{}',
    "status"        TEXT           NOT NULL DEFAULT 'DRAFT',
    "confirmedAt"   TIMESTAMPTZ(3),
    "confirmedById" UUID,
    "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "direct_tax_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_tax_plans_taxYear_key" UNIQUE ("taxYear")
);

CREATE TABLE IF NOT EXISTS "direct_tax_returns" (
    "id"                 UUID           NOT NULL DEFAULT gen_random_uuid(),
    "taxYear"            INTEGER        NOT NULL,
    "revenueRials"       BIGINT         NOT NULL DEFAULT 0,
    "costRials"          BIGINT         NOT NULL DEFAULT 0,
    "taxableIncomeRials" BIGINT         NOT NULL DEFAULT 0,
    "taxRatePercent"     INTEGER        NOT NULL DEFAULT 0,
    "taxDueRials"        BIGINT         NOT NULL DEFAULT 0,
    "prepaidRials"       BIGINT         NOT NULL DEFAULT 0,
    "payableRials"       BIGINT         NOT NULL DEFAULT 0,
    "linesJson"          JSONB          NOT NULL DEFAULT '{}',
    "status"             TEXT           NOT NULL DEFAULT 'DRAFT',
    "workflowInstanceId" UUID,
    "submittedAt"        TIMESTAMPTZ(3),
    "submittedById"      UUID,
    "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "direct_tax_returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_tax_returns_taxYear_key" UNIQUE ("taxYear")
);
