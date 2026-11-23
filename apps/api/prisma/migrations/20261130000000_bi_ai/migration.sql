-- موج ۴ — فاز ۱۱: BI و هوش مصنوعی گسترده
CREATE TABLE "bi_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taxYear" INTEGER NOT NULL,
    "periodCode" TEXT NOT NULL,
    "costCenterCode" TEXT NOT NULL,
    "revenueRials" BIGINT NOT NULL DEFAULT 0,
    "costRials" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bi_budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bi_budgets_taxYear_periodCode_costCenterCode_key" ON "bi_budgets"("taxYear", "periodCode", "costCenterCode");

CREATE TABLE "ai_rate_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roomTypeCode" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "baseRials" BIGINT NOT NULL,
    "suggestedRials" BIGINT NOT NULL,
    "confidenceLow" BIGINT NOT NULL,
    "confidenceHigh" BIGINT NOT NULL,
    "reasonJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_rate_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_rate_suggestions_businessDate_idx" ON "ai_rate_suggestions"("businessDate");

CREATE TABLE "ai_doc_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sourceText" TEXT NOT NULL,
    "extractedJson" JSONB NOT NULL DEFAULT '{}',
    "suggestedLinesJson" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "draftEntryId" UUID,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_doc_drafts_pkey" PRIMARY KEY ("id")
);
