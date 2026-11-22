-- مهاجرت فاز ۵ — صندوق، پرداخت و خزانه‌داری (نقشه ۷.۲)
-- CashAccount, CashierShift, CashTransaction, BankStatementLine, ReconciliationRun

-- CreateEnum
CREATE TYPE "cash_account_kind" AS ENUM ('CASH_DRAWER', 'BANK');

-- CreateEnum
CREATE TYPE "cash_shift_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "cash_txn_kind" AS ENUM ('RECEIPT', 'PAYMENT', 'TRANSFER', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "cash_txn_method" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'ONLINE');

-- CreateEnum
CREATE TYPE "cash_txn_status" AS ENUM ('POSTED', 'VOID');

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "kind" "cash_account_kind" NOT NULL,
    "glAccountCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "openingFloatRials" BIGINT NOT NULL DEFAULT 0,
    "countedRials" BIGINT,
    "varianceRials" BIGINT,
    "status" "cash_shift_status" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "openedById" UUID,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "txnNo" TEXT NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "shiftId" UUID,
    "kind" "cash_txn_kind" NOT NULL,
    "method" "cash_txn_method" NOT NULL,
    "amountRials" BIGINT NOT NULL,
    "traceNo" TEXT,
    "counterGlAccountCode" TEXT,
    "stayId" UUID,
    "payerName" TEXT,
    "note" TEXT,
    "businessDate" DATE NOT NULL,
    "status" "cash_txn_status" NOT NULL DEFAULT 'POSTED',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cashAccountId" UUID NOT NULL,
    "valueDate" DATE NOT NULL,
    "externalRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "debitRials" BIGINT NOT NULL DEFAULT 0,
    "creditRials" BIGINT NOT NULL DEFAULT 0,
    "matchedTxnId" UUID,
    "matchedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cashAccountId" UUID NOT NULL,
    "runDate" DATE NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "closedById" UUID,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_code_key" ON "cash_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_shifts_code_key" ON "cashier_shifts"("code");

-- CreateIndex
CREATE INDEX "cashier_shifts_cashAccountId_status_idx" ON "cashier_shifts"("cashAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_txnNo_key" ON "cash_transactions"("txnNo");

-- CreateIndex
CREATE INDEX "cash_transactions_cashAccountId_businessDate_idx" ON "cash_transactions"("cashAccountId", "businessDate");

-- CreateIndex
CREATE INDEX "cash_transactions_kind_status_idx" ON "cash_transactions"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_idempotencyKey_key" ON "cash_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_cashAccountId_externalRef_key" ON "bank_statement_lines"("cashAccountId", "externalRef");

-- CreateIndex
CREATE INDEX "bank_statement_lines_cashAccountId_valueDate_idx" ON "bank_statement_lines"("cashAccountId", "valueDate");

-- CreateIndex
CREATE INDEX "reconciliation_runs_cashAccountId_runDate_idx" ON "reconciliation_runs"("cashAccountId", "runDate");

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
