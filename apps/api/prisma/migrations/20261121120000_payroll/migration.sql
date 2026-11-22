-- CreateEnum
CREATE TYPE "decision_status" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "payroll_run_status" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationalId" TEXT,
    "iban" TEXT,
    "marital" BOOLEAN NOT NULL DEFAULT false,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "hireDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "baseSalary" BIGINT NOT NULL,
    "seniority" BIGINT NOT NULL DEFAULT 0,
    "housing" BIGINT NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "status" "decision_status" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "periodCode" TEXT NOT NULL,
    "status" "payroll_run_status" NOT NULL DEFAULT 'DRAFT',
    "paramsVersion" TEXT NOT NULL,
    "grossRials" BIGINT NOT NULL DEFAULT 0,
    "netRials" BIGINT NOT NULL DEFAULT 0,
    "taxRials" BIGINT NOT NULL DEFAULT 0,
    "insEmployeeRials" BIGINT NOT NULL DEFAULT 0,
    "insEmployerRials" BIGINT NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "skippedJson" JSONB,
    "journalEntryId" UUID,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_slips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "mizanRials" BIGINT NOT NULL DEFAULT 0,
    "dailyRials" BIGINT NOT NULL DEFAULT 0,
    "hourlyRials" BIGINT NOT NULL DEFAULT 0,
    "overtimeRials" BIGINT NOT NULL DEFAULT 0,
    "nightRials" BIGINT NOT NULL DEFAULT 0,
    "housingRials" BIGINT NOT NULL DEFAULT 0,
    "childAllowRials" BIGINT NOT NULL DEFAULT 0,
    "absentRials" BIGINT NOT NULL DEFAULT 0,
    "grossRials" BIGINT NOT NULL DEFAULT 0,
    "insEmployeeRials" BIGINT NOT NULL DEFAULT 0,
    "insEmployerRials" BIGINT NOT NULL DEFAULT 0,
    "monthlyTaxableRials" BIGINT NOT NULL DEFAULT 0,
    "annualTaxableRials" BIGINT NOT NULL DEFAULT 0,
    "taxRials" BIGINT NOT NULL DEFAULT 0,
    "netRials" BIGINT NOT NULL DEFAULT 0,
    "overridesJson" JSONB,
    "paramsVersion" TEXT NOT NULL,

    CONSTRAINT "payroll_slips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_nationalId_key" ON "employees"("nationalId");

-- CreateIndex
CREATE INDEX "salary_decisions_employeeId_effectiveFrom_status_idx" ON "salary_decisions"("employeeId", "effectiveFrom", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_periodCode_key" ON "payroll_runs"("periodCode");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_slips_runId_employeeId_key" ON "payroll_slips"("runId", "employeeId");

-- AddForeignKey
ALTER TABLE "salary_decisions" ADD CONSTRAINT "salary_decisions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_slips" ADD CONSTRAINT "payroll_slips_runId_fkey" FOREIGN KEY ("runId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_slips" ADD CONSTRAINT "payroll_slips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

