/**
 * directtax.service.ts — فاز ۹ / F9-T5: مالیات مستقیم — برنامهٔ عملکرد، اظهارنامهٔ عملکرد،
 * شناسهٔ طرف‌های معامله (قرارداد §3 قانون مالیات‌های مستقیم).
 *
 * قواعد:
 * - نرخ و معافیت‌ها پارامتریک از کتابخانهٔ قوانین F9-T1 (LAW-DIRECT-TAX-RATE — مادهٔ ۱۰۵).
 * - ارسال اظهارنامه هرگز بدون تأیید انسانی (گردش کار F8-T6، تعریف seed WF-DIRECTTAX-SUBMIT).
 * - شناسهٔ طرف‌های معامله از دادهٔ واقعی تجمیع می‌شود (معاملات فصلی F9-T4 + صورتحساب‌های مؤدیان
 *   F9-T2) با پرچم کامل‌بودن داده — «داده‌های الزامی کامل» یعنی کامل‌بودن گزارش و اعلام شکاف‌ها.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EVENT_NAMES, type EventEnvelope } from '@hotel-erp/contracts';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ComplianceService } from './compliance.service';
import { quarterRange } from './quarterly.service';

export const DIRECTTAX_SUBMIT_DEF = 'WF-DIRECTTAX-SUBMIT';
const DIRECTTAX_LAW = 'LAW-DIRECT-TAX-RATE';

const REVENUE_ACCOUNTS = ['4101', '4102', '4103'];
const COST_ACCOUNTS = ['5101', '5102', '5103', '5104', '5201'];
const PAYROLL_TAX_ACCOUNT = '2203'; // مالیات حقوق پرداختنی — پیش‌پرداخت عملکرد

@Injectable()
export class DirectTaxService {
  private readonly logger = new Logger('DirectTax');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly workflow: WorkflowService,
    private readonly laws: ComplianceService,
  ) {
    // ارسال اظهارنامه پس از تأیید انسانی گردش کار (تکرارپذیر)
    this.outbox.on(EVENT_NAMES.WORKFLOW_COMPLETED, (e) => this.handleCompleted(e as EventEnvelope<{ defCode?: string; entityId?: string; instanceId?: string }>));
    this.logger.log('outbox handler registered for workflow.completed (WF-DIRECTTAX-SUBMIT)');
  }

  /** بازهٔ میلادی سال مالیاتی شمسی [آغاز سال، آغاز سال بعد) */
  private yearRange(taxYear: number): { start: Date; end: Date } {
    return { start: quarterRange(taxYear, 1).start, end: quarterRange(taxYear + 1, 1).start };
  }

  private validateYear(taxYear: number): void {
    if (!Number.isInteger(taxYear) || taxYear < 1300 || taxYear > 1500) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'سال مالیاتی شمسی نامعتبر است' });
    }
  }

  // ───────────────── برنامهٔ عملکرد ─────────────────

  /** ثبت/به‌روزرسانی برنامهٔ عملکرد سال — پس از تأیید فقط با بازگشایی admin */
  async upsertPlan(input: { taxYear: number; planJson: Record<string, unknown>; userId: string }) {
    this.validateYear(input.taxYear);
    const existing = await this.prisma.directTaxPlan.findUnique({ where: { taxYear: input.taxYear } });
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'برنامهٔ عملکرد این سال تأیید شده است — برای اصلاح بازگشایی لازم است' });
    }
    const plan = existing
      ? await this.prisma.directTaxPlan.update({ where: { id: existing.id }, data: { planJson: input.planJson as never } })
      : await this.prisma.directTaxPlan.create({ data: { taxYear: input.taxYear, planJson: input.planJson as never } });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'DIRECTTAX_PLAN_UPSERTED', entity: 'DirectTaxPlan', entityId: plan.id, reason: `سال ${input.taxYear}` },
    });
    return { data: this.planDto(plan) };
  }

  async confirmPlan(input: { taxYear: number; userId: string }) {
    const plan = await this.prisma.directTaxPlan.findUnique({ where: { taxYear: input.taxYear } });
    if (!plan) throw new NotFoundException({ code: 'NOT_FOUND', message: 'برنامهٔ عملکرد این سال ثبت نشده است' });
    if (plan.status !== 'DRAFT') throw new ConflictException({ code: 'CONFLICT', message: 'برنامهٔ عملکرد قبلاً تأیید شده است' });
    const updated = await this.prisma.directTaxPlan.update({
      where: { id: plan.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: input.userId },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'DIRECTTAX_PLAN_CONFIRMED', entity: 'DirectTaxPlan', entityId: plan.id, reason: `سال ${input.taxYear}` },
    });
    return { data: this.planDto(updated) };
  }

  async getPlan(taxYear: number) {
    this.validateYear(taxYear);
    const plan = await this.prisma.directTaxPlan.findUnique({ where: { taxYear } });
    return { data: plan ? this.planDto(plan) : null };
  }

  // ───────────────── اظهارنامهٔ عملکرد ─────────────────

  /** محاسبهٔ اظهارنامه از اسناد قطعی سال + نرخ کتابخانهٔ قوانین — Idempotent در حالت DRAFT */
  async compute(input: { taxYear: number; userId: string }) {
    this.validateYear(input.taxYear);
    const existing = await this.prisma.directTaxReturn.findUnique({ where: { taxYear: input.taxYear } });
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'اظهارنامه ارسال شده است — محاسبهٔ مجدد فقط پس از بازگشایی' });
    }
    const { start, end } = this.yearRange(input.taxYear);
    const entries = await this.prisma.journalEntry.findMany({
      where: { postingDate: { gte: start, lt: end }, status: 'POSTED' },
      include: { lines: true },
      take: 5000,
    });

    const revByAcc = new Map<string, bigint>();
    const costByAcc = new Map<string, bigint>();
    let revenue = 0n;
    let cost = 0n;
    let prepaid = 0n;
    for (const e of entries) {
      for (const l of e.lines) {
        if (REVENUE_ACCOUNTS.includes(l.accountCode)) {
          const net = l.creditRials - l.debitRials;
          if (net > 0n) { revenue += net; revByAcc.set(l.accountCode, (revByAcc.get(l.accountCode) ?? 0n) + net); }
        } else if (COST_ACCOUNTS.includes(l.accountCode)) {
          const net = l.debitRials - l.creditRials;
          if (net > 0n) { cost += net; costByAcc.set(l.accountCode, (costByAcc.get(l.accountCode) ?? 0n) + net); }
        } else if (l.accountCode === PAYROLL_TAX_ACCOUNT) {
          if (l.creditRials > 0n) prepaid += l.creditRials;
        }
      }
    }

    // نرخ از کتابخانهٔ قوانین — پارامتریک و تاریخ‌دار
    const params = await this.laws.rateAt(DIRECTTAX_LAW, start);
    const ratePercent = Math.trunc(Number(params.corporateRatePercent));
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      throw new ConflictException({ code: 'CONFLICT', message: 'نرخ مادهٔ ۱۰۵ در کتابخانهٔ قوانین نامعتبر است' });
    }

    const taxable = revenue > cost ? revenue - cost : 0n;
    const taxDue = (taxable * BigInt(ratePercent)) / 100n;
    const payable = taxDue > prepaid ? taxDue - prepaid : 0n;

    const data = {
      taxYear: input.taxYear,
      revenueRials: revenue, costRials: cost, taxableIncomeRials: taxable,
      taxRatePercent: ratePercent, taxDueRials: taxDue, prepaidRials: prepaid, payableRials: payable,
      linesJson: {
        revenueByAccount: Object.fromEntries([...revByAcc].map(([k, v]) => [k, v.toString()])),
        costByAccount: Object.fromEntries([...costByAcc].map(([k, v]) => [k, v.toString()])),
        revenueAccounts: REVENUE_ACCOUNTS, costAccounts: COST_ACCOUNTS, prepaidAccount: PAYROLL_TAX_ACCOUNT,
        lawCode: DIRECTTAX_LAW, computedAt: new Date().toISOString(),
      } as never,
    };
    const ret = existing
      ? await this.prisma.directTaxReturn.update({ where: { id: existing.id }, data })
      : await this.prisma.directTaxReturn.create({ data });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'DIRECTTAX_COMPUTED', entity: 'DirectTaxReturn', entityId: ret.id, reason: `سال ${input.taxYear} — نرخ ${ratePercent}٪` },
    });
    return { data: this.returnDto(ret) };
  }

  async getReturn(taxYear: number) {
    this.validateYear(taxYear);
    const ret = await this.prisma.directTaxReturn.findUnique({ where: { taxYear } });
    return { data: ret ? this.returnDto(ret) : null };
  }

  /**
   * شناسهٔ طرف‌های معامله — تجمیع دادهٔ واقعی سال: معاملات فصلی (F9-T4) + صورتحساب‌های مؤدیان
   * (F9-T2)؛ پرچم کامل‌بودن برای سطرهای بدون شناسهٔ مالیاتی («داده‌های الزامی کامل»).
   */
  async counterparties(taxYear: number) {
    this.validateYear(taxYear);
    const { start, end } = this.yearRange(taxYear);
    const agg = new Map<string, { tin: string; name: string; saleRials: bigint; purchaseRials: bigint; count: number; sources: Set<string> }>();
    // شناسهٔ '-' یعنی ناشناس (بدون شناسهٔ مالیاتی) — مثل خالی رفتار می‌شود
    const normTin = (tin: string): string => (tin === '-' || tin === '0' ? '' : tin.trim());
    const touch = (tin: string, name: string, source: string) => {
      const t = normTin(tin);
      const key = t === '' ? `NO-TIN:${name}` : t;
      const cur = agg.get(key) ?? { tin: t, name, saleRials: 0n, purchaseRials: 0n, count: 0, sources: new Set<string>() };
      cur.sources.add(source);
      if (t && !cur.name) cur.name = name;
      return cur;
    };

    const periods = await this.prisma.quarterlyPeriod.findMany({ where: { taxYear } });
    if (periods.length) {
      const txs = await this.prisma.quarterlyTx.findMany({ where: { periodId: { in: periods.map((p) => p.id) } } });
      for (const t of txs) {
        const t2 = normTin(t.counterpartyTin);
        const cur = touch(t2, t.counterpartyName, 'quarterly');
        cur.count += 1;
        if (t.txType === 'SALE') cur.saleRials += t.amountRials; else cur.purchaseRials += t.amountRials;
        agg.set(t2 === '' ? `NO-TIN:${t.counterpartyName}` : t2, cur);
      }
    }

    const invoices = await this.prisma.moadianInvoice.findMany({
      where: { issueDate: { gte: start, lt: end }, status: { in: ['SENT', 'ACCEPTED'] } },
    });
    for (const inv of invoices) {
      const bt = normTin(inv.buyerTaxId);
      const cur = touch(bt, inv.buyerName || 'بدون شناسهٔ خریدار', 'moadian');
      cur.count += 1;
      cur.saleRials += inv.totalRials > 0n ? inv.totalRials : 0n;
      agg.set(bt === '' ? `NO-TIN:${inv.buyerName || 'بدون شناسهٔ خریدار'}` : bt, cur);
    }

    const rows = [...agg.values()].map((r) => ({
      tin: r.tin || null,
      name: r.name,
      saleRials: r.saleRials.toString(),
      purchaseRials: r.purchaseRials.toString(),
      transactionCount: r.count,
      sources: [...r.sources],
      complete: r.tin !== '',
    }));
    rows.sort((a, b) => (a.saleRials < b.saleRials ? 1 : -1));
    return { data: { taxYear, count: rows.length, incomplete: rows.filter((r) => !r.complete).length, rows } };
  }

  /** درخواست ارسال اظهارنامه — فقط با برنامهٔ عملکرد تأییدشده و تأیید انسانی گردش کار */
  async submit(input: { taxYear: number; userId: string; userPerms: Set<string> }) {
    this.validateYear(input.taxYear);
    const plan = await this.prisma.directTaxPlan.findUnique({ where: { taxYear: input.taxYear } });
    if (!plan || plan.status !== 'CONFIRMED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'ابتدا برنامهٔ عملکرد سال را ثبت و تأیید کنید' });
    }
    let ret = await this.prisma.directTaxReturn.findUnique({ where: { taxYear: input.taxYear } });
    if (ret && ret.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'اظهارنامه قبلاً ارسال شده است' });
    }
    if (!ret) {
      const computed = await this.compute({ taxYear: input.taxYear, userId: input.userId });
      ret = await this.prisma.directTaxReturn.findUnique({ where: { taxYear: input.taxYear } });
      if (!ret) throw new ConflictException({ code: 'CONFLICT', message: 'محاسبهٔ اظهارنامه ناموفق بود' });
      void computed;
    }

    if (ret.workflowInstanceId) {
      const inst = await this.prisma.workflowInstance.findUnique({ where: { id: ret.workflowInstanceId } });
      if (inst && inst.status === 'IN_PROGRESS') return this.workflow.detail(inst.id);
    }
    const inst = await this.workflow.start({
      defCode: DIRECTTAX_SUBMIT_DEF,
      entityType: 'direct_tax_return',
      entityId: ret.id,
      title: `ارسال اظهارنامهٔ عملکرد سال ${input.taxYear}`,
      userId: input.userId,
      userPerms: input.userPerms,
    });
    await this.prisma.directTaxReturn.update({ where: { id: ret.id }, data: { workflowInstanceId: inst.data.id } });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'DIRECTTAX_SUBMIT_REQUESTED', entity: 'DirectTaxReturn', entityId: ret.id, reason: `سال ${input.taxYear}` },
    });
    return inst;
  }

  /** بازگشایی اظهارنامه برای اصلاح — فقط admin */
  async reopen(input: { taxYear: number; userId: string; userPerms: Set<string> }) {
    if (!input.userPerms.has('workflow.manage')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'بازگشایی اظهارنامه فقط توسط مدیر سیستم' });
    }
    const ret = await this.prisma.directTaxReturn.findUnique({ where: { taxYear: input.taxYear } });
    if (!ret) throw new NotFoundException({ code: 'NOT_FOUND', message: 'اظهارنامهٔ این سال محاسبه نشده است' });
    const updated = await this.prisma.directTaxReturn.update({
      where: { id: ret.id },
      data: { status: 'DRAFT', submittedAt: null, submittedById: null, workflowInstanceId: null },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'DIRECTTAX_REOPENED', entity: 'DirectTaxReturn', entityId: ret.id, reason: `سال ${input.taxYear}` },
    });
    return { data: this.returnDto(updated) };
  }

  /** فایل استاندارد اظهارنامه — فقط پس از تأیید انسانی (SUBMITTED) */
  async exportCsv(taxYear: number): Promise<string> {
    const ret = await this.prisma.directTaxReturn.findUnique({ where: { taxYear } });
    if (!ret) throw new NotFoundException({ code: 'NOT_FOUND', message: 'اظهارنامهٔ این سال محاسبه نشده است' });
    if (ret.status !== 'SUBMITTED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'فایل استاندارد فقط پس از تأیید انسانی اظهارنامه قابل دریافت است' });
    }
    const plan = await this.prisma.directTaxPlan.findUnique({ where: { taxYear } });
    const cp = (await this.counterparties(taxYear)).data;
    const L: Array<[string, string, string]> = [
      ['اظهارنامه', 'سال مالیاتی', String(ret.taxYear)],
      ['اظهارنامه', 'جمع درآمد (ریال)', ret.revenueRials.toString()],
      ['اظهارنامه', 'جمع هزینه‌های قابل قبول (ریال)', ret.costRials.toString()],
      ['اظهارنامه', 'درآمد مشمول (ریال)', ret.taxableIncomeRials.toString()],
      ['اظهارنامه', 'نرخ مالیات (ماده ۱۰۵ — ٪)', String(ret.taxRatePercent)],
      ['اظهارنامه', 'مالیات متعلق (ریال)', ret.taxDueRials.toString()],
      ['اظهارنامه', 'مالیات پیش‌پرداخت‌شده/کسرشده (ریال)', ret.prepaidRials.toString()],
      ['اظهارنامه', 'مالیات قابل پرداخت (ریال)', ret.payableRials.toString()],
      ['برنامه عملکرد', 'وضعیت برنامهٔ عملکرد', plan ? plan.status : 'ثبت نشده'],
      ['برنامه عملکرد', 'محتوای برنامه', JSON.stringify(plan?.planJson ?? {})],
      ['شناسهٔ طرف‌های معامله', 'تعداد طرف‌های معامله', String(cp.count)],
      ['شناسهٔ طرف‌های معامله', 'سطرهای ناقص (بدون شناسهٔ مالیاتی)', String(cp.incomplete)],
    ];
    for (const r of cp.rows) {
      L.push(['شناسهٔ طرف‌های معامله', `${r.complete ? r.tin : 'ناقص'} — ${r.name}`, `فروش ${r.saleRials} / خرید ${r.purchaseRials} / تعداد ${r.transactionCount} / منبع ${r.sources.join('+')}`]);
    }
    const lines = ['بخش,عنوان,مقدار', ...L.map((r) => r.map((c) => this.csvCell(c)).join(','))];
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /** مصرف‌کنندهٔ workflow.completed — اظهارنامه را SUBMITTED می‌کند (تکرارپذیر) */
  private async handleCompleted(e: EventEnvelope<{ defCode?: string; entityId?: string; instanceId?: string }>): Promise<void> {
    try {
      if (e.payload?.defCode !== DIRECTTAX_SUBMIT_DEF || !e.payload.entityId) return;
      const ret = await this.prisma.directTaxReturn.findUnique({ where: { id: e.payload.entityId } });
      if (!ret || ret.status === 'SUBMITTED') return; // idempotent
      const inst = await this.prisma.workflowInstance.findUnique({
        where: { id: e.payload.instanceId ?? '' },
        include: { actions: { orderBy: { at: 'asc' } } },
      });
      const approver = [...(inst?.actions ?? [])].reverse().find((a) => a.action === 'APPROVE')?.actorId ?? null;
      await this.prisma.directTaxReturn.update({
        where: { id: ret.id },
        data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: approver },
      });
      await this.prisma.auditLog.create({
        data: { userId: approver, action: 'DIRECTTAX_SUBMITTED', entity: 'DirectTaxReturn', entityId: ret.id, reason: `workflow ${e.payload.instanceId}` },
      });
      this.logger.log(`direct-tax return submitted via workflow: id=${ret.id}`);
    } catch (err) {
      this.logger.error(`handleCompleted failed: ${String(err)}`);
      throw err; // Outbox تلاش مجدد می‌کند
    }
  }

  private csvCell(v: string): string {
    return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replaceAll('"', '""')}"` : v;
  }

  private planDto(r: {
    id: string; taxYear: number; planJson: unknown; status: string;
    confirmedAt: Date | null; confirmedById: string | null;
  }) {
    return {
      id: r.id, taxYear: r.taxYear, plan: r.planJson, status: r.status,
      confirmedAt: r.confirmedAt?.toISOString() ?? null, confirmedById: r.confirmedById,
    };
  }

  private returnDto(r: {
    id: string; taxYear: number; revenueRials: bigint; costRials: bigint; taxableIncomeRials: bigint;
    taxRatePercent: number; taxDueRials: bigint; prepaidRials: bigint; payableRials: bigint;
    linesJson: unknown; status: string; workflowInstanceId: string | null;
    submittedAt: Date | null; submittedById: string | null;
  }) {
    return {
      id: r.id, taxYear: r.taxYear,
      revenueRials: r.revenueRials.toString(), costRials: r.costRials.toString(),
      taxableIncomeRials: r.taxableIncomeRials.toString(), taxRatePercent: r.taxRatePercent,
      taxDueRials: r.taxDueRials.toString(), prepaidRials: r.prepaidRials.toString(),
      payableRials: r.payableRials.toString(), lines: r.linesJson, status: r.status,
      workflowInstanceId: r.workflowInstanceId,
      submittedAt: r.submittedAt?.toISOString() ?? null, submittedById: r.submittedById,
    };
  }
}
