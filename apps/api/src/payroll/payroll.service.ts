/**
 * payroll.service.ts — F2-T1…T4: پرسنل، احکام، اجرای دوره حقوق با موتور نسخه‌دار
 * (@hotel-erp/payroll) و رویداد payroll.run.approved در همان تراکنش (Transactional Outbox).
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import {
  runPeriod, isValidIranIban, bankList, insuranceList, taxList,
  type EmployeeInput, type SlipOverrides,
} from '@hotel-erp/payroll';
import { jalaaliMonthLength, toGregorian } from '@hotel-erp/shared';

export interface CreateEmployeeInput {
  code: string;
  firstName: string;
  lastName: string;
  nationalId?: string | null;
  iban?: string | null;
  marital: boolean;
  dependents: number;
  hireDate?: string | null;
}

/** پایان دوره شمسی '1405-09' → تاریخ میلادی (برای فیلتر احکام) */
function periodEndDate(periodCode: string): Date {
  const m = periodCode.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new BadRequestException({ code: 'VALIDATION', message: 'periodCode must be like 1405-09' });
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  if (jm < 1 || jm > 12) throw new BadRequestException({ code: 'VALIDATION', message: 'month must be 01..12' });
  const g = toGregorian(jy, jm, jalaaliMonthLength(jy, jm));
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
}

const B = (v: number | string): bigint => BigInt(Math.trunc(Number(v)));

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  /* ── پرسنل (F2-T1) ── */

  private assertIban(iban?: string | null): void {
    if (iban && !isValidIranIban(iban)) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'IBAN is not a valid Iranian sheba' });
    }
  }

  async createEmployee(input: CreateEmployeeInput, userId: string) {
    this.assertIban(input.iban);
    const exists = await this.prisma.employee.findUnique({ where: { code: input.code } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: `Employee code already exists: ${input.code}` });
    const emp = await this.prisma.employee.create({
      data: {
        code: input.code,
        firstName: input.firstName,
        lastName: input.lastName,
        nationalId: input.nationalId ?? null,
        iban: input.iban ?? null,
        marital: input.marital,
        dependents: input.dependents,
        hireDate: input.hireDate ? new Date(`${input.hireDate}T00:00:00Z`) : null,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'EMPLOYEE_CREATED', entity: 'Employee', entityId: emp.id },
    });
    return emp;
  }

  async listEmployees(activeOnly: boolean) {
    return this.prisma.employee.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async updateEmployee(id: string, patch: Partial<CreateEmployeeInput> & { active?: boolean }, userId: string) {
    this.assertIban(patch.iban ?? undefined);
    const emp = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
        ...(patch.nationalId !== undefined ? { nationalId: patch.nationalId } : {}),
        ...(patch.iban !== undefined ? { iban: patch.iban } : {}),
        ...(patch.marital !== undefined ? { marital: patch.marital } : {}),
        ...(patch.dependents !== undefined ? { dependents: patch.dependents } : {}),
        ...(patch.hireDate !== undefined ? { hireDate: patch.hireDate ? new Date(`${patch.hireDate}T00:00:00Z`) : null } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'EMPLOYEE_UPDATED', entity: 'Employee', entityId: id },
    });
    return emp;
  }

  /* ── احکام حقوق (چرخه پیش‌نویس → تأیید، هم‌الگوی اسناد مالی) ── */

  async createDecision(input: {
    employeeId: string;
    baseSalary: string;
    seniority: string;
    housing: string;
    effectiveFrom: string;
    note?: string;
  }, userId: string) {
    const emp = await this.prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!emp) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found' });
    const decision = await this.prisma.salaryDecision.create({
      data: {
        employeeId: input.employeeId,
        baseSalary: B(input.baseSalary),
        seniority: B(input.seniority),
        housing: B(input.housing),
        effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`),
        note: input.note ?? null,
        createdById: userId,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'SALARY_DECISION_CREATED', entity: 'SalaryDecision', entityId: decision.id },
    });
    return decision;
  }

  async approveDecision(id: string, userId: string) {
    const decision = await this.prisma.salaryDecision.findUnique({ where: { id } });
    if (!decision) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Decision not found' });
    if (decision.status === 'APPROVED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Decision already approved' });
    }
    const updated = await this.prisma.salaryDecision.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'SALARY_DECISION_APPROVED', entity: 'SalaryDecision', entityId: id },
    });
    return updated;
  }

  /* ── اجرای دوره حقوق (F2-T3) ── */

  async calculateRun(periodCode: string, userId: string) {
    const existing = await this.prisma.payrollRun.findUnique({ where: { periodCode } });
    if (existing?.status === 'APPROVED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Payroll period already approved and immutable' });
    }

    const end = periodEndDate(periodCode);
    const employees = await this.prisma.employee.findMany({ where: { active: true }, orderBy: { code: 'asc' } });

    // مبنای محاسبه: آخرین حکم تأییدشده قبل از پایان دوره (الگوی payroll-releases: مزد مبنا = شغل + سنوات)
    const decisions = await this.prisma.salaryDecision.findMany({
      where: { status: 'APPROVED', effectiveFrom: { lte: end } },
      orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'desc' }],
    });
    const decisionByEmployee = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) {
      if (!decisionByEmployee.has(d.employeeId)) decisionByEmployee.set(d.employeeId, d);
    }

    const personnel: Array<{ employee: EmployeeInput; overrides?: SlipOverrides }> = [];
    const skipped: Array<{ code: string; name: string; reason: string }> = [];
    for (const e of employees) {
      const d = decisionByEmployee.get(e.id);
      const name = `${e.firstName} ${e.lastName}`;
      if (!d) {
        skipped.push({ code: e.code, name, reason: 'NO_APPROVED_DECISION' });
        continue;
      }
      personnel.push({
        employee: {
          code: e.code,
          firstName: e.firstName,
          lastName: e.lastName,
          marital: e.marital,
          dependents: e.dependents,
          baseSalary: Number(d.baseSalary),
          seniority: Number(d.seniority),
          housing: Number(d.housing),
          iban: e.iban ?? '',
        },
      });
    }

    const result = runPeriod(personnel, periodCode);
    result.skipped.push(...skipped);
    const employeeIdByCode = new Map(employees.map((e) => [e.code, e.id]));

    const row = await this.prisma.$transaction(async (tx) => {
      let runId: string;
      if (existing) {
        // محاسبه مجدد دوره پیش‌نویس: فیش‌های قبلی حذف و بازمحاسبه
        await tx.payrollSlip.deleteMany({ where: { runId: existing.id } });
        const updated = await tx.payrollRun.update({
          where: { id: existing.id },
          data: {
            paramsVersion: result.paramsVersion,
            grossRials: BigInt(result.totals.gross),
            netRials: BigInt(result.totals.net),
            taxRials: BigInt(result.totals.tax),
            insEmployeeRials: BigInt(result.totals.insuranceEmployee),
            insEmployerRials: BigInt(result.totals.insuranceEmployer),
            employeeCount: result.totals.count,
            skippedJson: result.skipped as unknown as import('@prisma/client').Prisma.InputJsonValue,
            createdById: userId,
          },
        });
        runId = updated.id;
      } else {
        const created = await tx.payrollRun.create({
          data: {
            periodCode,
            paramsVersion: result.paramsVersion,
            grossRials: BigInt(result.totals.gross),
            netRials: BigInt(result.totals.net),
            taxRials: BigInt(result.totals.tax),
            insEmployeeRials: BigInt(result.totals.insuranceEmployee),
            insEmployerRials: BigInt(result.totals.insuranceEmployer),
            employeeCount: result.totals.count,
            skippedJson: result.skipped as unknown as import('@prisma/client').Prisma.InputJsonValue,
            createdById: userId,
          },
        });
        runId = created.id;
      }

      await tx.payrollSlip.createMany({
        data: result.slips.map((s) => ({
          runId,
          employeeId: employeeIdByCode.get(s.code) ?? '',
          mizanRials: BigInt(s.mizan),
          dailyRials: BigInt(s.daily),
          hourlyRials: BigInt(s.hourly),
          overtimeRials: BigInt(s.overtime),
          nightRials: BigInt(s.night),
          housingRials: BigInt(s.housing),
          childAllowRials: BigInt(s.childAllow),
          absentRials: BigInt(s.absent),
          grossRials: BigInt(s.gross),
          insEmployeeRials: BigInt(s.insEmployee),
          insEmployerRials: BigInt(s.insEmployer),
          monthlyTaxableRials: BigInt(s.monthlyTaxable),
          annualTaxableRials: BigInt(s.annualTaxable),
          taxRials: BigInt(s.tax),
          netRials: BigInt(s.net),
          overridesJson: s.params as unknown as import('@prisma/client').Prisma.InputJsonValue,
          paramsVersion: s.paramsVersion,
        })),
      });
      return tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { slips: true } });
    });

    await this.prisma.auditLog.create({
      data: { userId, action: 'PAYROLL_RUN_CALCULATED', entity: 'PayrollRun', entityId: row.id },
    });
    return row;
  }

  async getRun(id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: { slips: { orderBy: { id: 'asc' }, include: { employee: { select: { code: true, firstName: true, lastName: true, iban: true } } } } },
    });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });
    return run;
  }

  async listRuns() {
    return this.prisma.payrollRun.findMany({ orderBy: { periodCode: 'desc' }, include: { slips: false } });
  }

  /* ── لیست‌های رسمی (F2-T4) ── */

  private async slipRowsFor(runId: string) {
    const run = await this.getRun(runId);
    return run;
  }

  async taxListOf(runId: string) {
    const run = await this.slipRowsFor(runId);
    return taxList(run.slips.map((s) => ({
      code: s.employee.code,
      name: `${s.employee.firstName} ${s.employee.lastName}`,
      monthlyTaxable: Number(s.monthlyTaxableRials),
      tax: Number(s.taxRials),
      period: run.periodCode,
    })));
  }

  async insuranceListOf(runId: string) {
    const run = await this.slipRowsFor(runId);
    return insuranceList(run.slips.map((s) => ({
      code: s.employee.code,
      name: `${s.employee.firstName} ${s.employee.lastName}`,
      mizan: Number(s.mizanRials),
      overtime: Number(s.overtimeRials),
      night: Number(s.nightRials),
      absent: Number(s.absentRials),
      insEmployee: Number(s.insEmployeeRials),
      insEmployer: Number(s.insEmployerRials),
      period: run.periodCode,
    })));
  }

  async bankListOf(runId: string) {
    const run = await this.slipRowsFor(runId);
    return bankList(run.slips.map((s) => ({
      code: s.employee.code,
      name: `${s.employee.firstName} ${s.employee.lastName}`,
      iban: s.employee.iban ?? '',
      net: Number(s.netRials),
      period: run.periodCode,
    })));
  }

  /* ── تأیید دوره + رویداد (F2-T4 سند خودکار) ── */

  async approveRun(id: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id }, include: { slips: true } });
    if (!run) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Run not found' });
    if (run.status === 'APPROVED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Payroll period already approved and immutable' });
    }
    if (run.employeeCount === 0) {
      throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'Run has no slips — nothing to approve' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payrollRun.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { userId, action: 'PAYROLL_RUN_APPROVED', entity: 'PayrollRun', entityId: id },
      });
      // رویداد در همان تراکنش — موتور سند خودکار آن را به سند دوطرفه می‌برد
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.PAYROLL_RUN_APPROVED,
        aggregate: 'payroll_run',
        idempotencyKey: run.id,
        producer: 'payroll',
        payload: {
          runId: run.id,
          periodCode: run.periodCode,
          grossRials: Number(run.grossRials),
          insEmployeeRials: Number(run.insEmployeeRials),
          insEmployerRials: Number(run.insEmployerRials),
          taxRials: Number(run.taxRials),
          netRials: Number(run.netRials),
          employeeCount: run.employeeCount,
          paramsVersion: run.paramsVersion,
        },
      });
      return u;
    });
    return updated;
  }
}
