/**
 * quarterly.service.ts — فاز ۹ / F9-T4: معاملات فصلی خارج از سامانه + فایل استاندارد اداره دارایی.
 *
 * قرارداد §3 مادهٔ ۱۶۹ + قاعدهٔ طلایی: بستن فصل (اعلام به دارایی) فقط با تأیید انسانی از طریق
 * موتور گردش کار F8-T6 — تعریف seed WF-QUARTERLY-CLOSE؛ مصرف‌کنندهٔ workflow.completed فصل را می‌بندد.
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
import { toGregorian, toJalaali } from '@hotel-erp/shared';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { WorkflowService } from '../workflow/workflow.service';

export const QUARTERLY_CLOSE_DEF = 'WF-QUARTERLY-CLOSE';

interface QuarterRange {
  start: Date;
  end: Date; // انحصاری
}

/** بازهٔ فصل شمسی: Q1 فروردین–خرداد، Q2 تیر–شهریور، Q3 مهر–آذر، Q4 دی–اسفند */
export function quarterRange(jy: number, quarter: number): QuarterRange {
  const m1 = (quarter - 1) * 3 + 1;
  const gStart = toGregorian(jy, m1, 1);
  const start = new Date(Date.UTC(gStart.gy, gStart.gm - 1, gStart.gd));
  const nm = m1 + 3;
  const gEnd = nm > 12 ? toGregorian(jy + 1, nm - 12, 1) : toGregorian(jy, nm, 1);
  const end = new Date(Date.UTC(gEnd.gy, gEnd.gm - 1, gEnd.gd));
  return { start, end };
}

/** تاریخ میلادی → رشتهٔ شمسی yyyy/mm/dd (برای فایل استاندارد) */
function toJalaliStr(d: Date): string {
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
}

@Injectable()
export class QuarterlyService {
  private readonly logger = new Logger('Quarterly');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly workflow: WorkflowService,
  ) {
    // بستن فصل پس از تأیید انسانی گردش کار (تکرارپذیر — idempotent)
    this.outbox.on(EVENT_NAMES.WORKFLOW_COMPLETED, (e) => this.handleCompleted(e as EventEnvelope<{ defCode?: string; entityId?: string; instanceId?: string }>));
    this.logger.log('outbox handler registered for workflow.completed (WF-QUARTERLY-CLOSE)');
  }

  /** فصل را تضمین می‌کند (ایجاد OPEN) و برمی‌گرداند */
  async ensurePeriod(taxYear: number, quarter: number) {
    this.validatePeriodInput(taxYear, quarter);
    const existing = await this.prisma.quarterlyPeriod.findUnique({
      where: { taxYear_quarter: { taxYear, quarter } },
    });
    if (existing) return existing;
    return this.prisma.quarterlyPeriod.create({ data: { taxYear, quarter } });
  }

  async listPeriods(taxYear?: number) {
    const where = taxYear ? { taxYear } : {};
    const rows = await this.prisma.quarterlyPeriod.findMany({ where: where as never, orderBy: [{ taxYear: 'desc' }, { quarter: 'asc' }] });
    return { data: rows.map((r) => this.periodDto(r)) };
  }

  /** ثبت معاملهٔ خارج از سامانه — فصل باید OPEN باشد */
  async register(input: {
    taxYear: number; quarter: number; txType: string; counterpartyName: string;
    counterpartyTin?: string; amountRials: string | number | bigint; vatRials?: string | number | bigint;
    txDate: string; exempt?: boolean; docRef?: string; notes?: string; userId: string;
  }) {
    const period = await this.ensurePeriod(input.taxYear, input.quarter);
    if (period.status !== 'OPEN') {
      throw new ConflictException({ code: 'CONFLICT', message: 'فصل بسته شده است — ثبت معامله ممکن نیست' });
    }
    if (!['SALE', 'PURCHASE'].includes(input.txType)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'نوع معامله باید SALE یا PURCHASE باشد' });
    }
    if (!input.counterpartyName || !input.counterpartyName.trim()) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'نام طرف معامله الزامی است' });
    }
    const tin = input.counterpartyTin ?? '-';
    if (tin !== '-' && !/^\d{10,12}$/.test(tin)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'شناسهٔ ملی باید ۱۰ یا کد اقتصادی ۱۲ رقم باشد (یا - برای ناشناس)' });
    }
    const amount = BigInt(input.amountRials);
    const vat = BigInt(input.vatRials ?? 0);
    if (amount <= 0n) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'مبلغ معامله باید مثبت باشد' });
    }
    if (vat < 0n || vat > amount) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'مالیات باید بین صفر و مبلغ معامله باشد' });
    }
    const range = quarterRange(input.taxYear, input.quarter);
    const txDate = new Date(input.txDate + 'T00:00:00.000Z');
    if (Number.isNaN(txDate.getTime()) || txDate < range.start || txDate >= range.end) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: `تاریخ معامله باید در بازهٔ فصل ${input.quarter} سال ${input.taxYear} باشد` });
    }
    const docRef = input.docRef?.trim() || `MANUAL:${crypto.randomUUID()}`;
    const dup = await this.prisma.quarterlyTx.findFirst({ where: { periodId: period.id, docRef } });
    if (dup) {
      throw new ConflictException({ code: 'CONFLICT', message: `مرجع سند ${docRef} قبلاً در این فصل ثبت شده است` });
    }
    const tx = await this.prisma.quarterlyTx.create({
      data: {
        periodId: period.id, txType: input.txType, counterpartyName: input.counterpartyName.trim(),
        counterpartyTin: tin, amountRials: amount, vatRials: vat, txDate,
        exempt: input.exempt ?? false, sourceType: 'MANUAL', docRef,
        notes: input.notes ?? '', registeredById: input.userId,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'QUARTERLY_TX_REGISTERED', entity: 'QuarterlyTx', entityId: tx.id, reason: docRef },
    });
    return { data: this.txDto(tx) };
  }

  /** استخراج خودکار سفارش‌های POS فصل — Idempotent */
  async deriveFromPos(input: { taxYear: number; quarter: number; userId: string }) {
    const period = await this.ensurePeriod(input.taxYear, input.quarter);
    if (period.status !== 'OPEN') {
      throw new ConflictException({ code: 'CONFLICT', message: 'فصل بسته شده است — استخراج ممکن نیست' });
    }
    const range = quarterRange(input.taxYear, input.quarter);
    const existing = await this.prisma.quarterlyTx.findMany({
      where: { periodId: period.id, sourceType: 'POS' },
      select: { docRef: true },
    });
    const have = new Set(existing.map((e) => e.docRef));
    const orders = await this.prisma.posOrder.findMany({
      where: { status: 'SERVED', servedAt: { gte: range.start, lt: range.end } },
      orderBy: { servedAt: 'asc' },
    });
    const fresh = orders.filter((o) => !have.has(`POS:${o.code}`));
    for (const o of fresh) {
      await this.prisma.quarterlyTx.create({
        data: {
          periodId: period.id, txType: 'SALE', counterpartyName: 'مشتری POS (ناشناس)', counterpartyTin: '-',
          amountRials: o.totalRials, vatRials: o.taxRials, txDate: o.servedAt, exempt: false,
          sourceType: 'POS', docRef: `POS:${o.code}`, registeredById: input.userId,
        },
      });
    }
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'QUARTERLY_POS_DERIVED', entity: 'QuarterlyPeriod', entityId: period.id, reason: `${fresh.length} سفارش` },
    });
    return { data: { derived: fresh.length, scanned: orders.length } };
  }

  async listTaxes(filters: { taxYear: number; quarter?: number; txType?: string }) {
    const periods = await this.prisma.quarterlyPeriod.findMany({
      where: { taxYear: filters.taxYear, ...(filters.quarter ? { quarter: filters.quarter } : {}) },
    });
    const rows = await this.prisma.quarterlyTx.findMany({
      where: {
        periodId: { in: periods.map((p) => p.id) },
        ...(filters.txType ? { txType: filters.txType } : {}),
      },
      orderBy: { txDate: 'asc' },
      take: 2000,
    });
    return { data: rows.map((r) => this.txDto(r)), count: rows.length };
  }

  async summary(taxYear: number, quarter: number) {
    const period = await this.prisma.quarterlyPeriod.findUnique({
      where: { taxYear_quarter: { taxYear, quarter } },
      include: { txs: true },
    });
    if (!period) return { data: { taxYear, quarter, status: 'OPEN', exists: false, sale: null, purchase: null, netVat: '0' } };
    const agg = (type: string) => {
      const rows = period.txs.filter((t) => t.txType === type);
      return {
        count: rows.length,
        total: rows.reduce((a, t) => a + t.amountRials, 0n).toString(),
        vat: rows.reduce((a, t) => a + t.vatRials, 0n).toString(),
        exemptCount: rows.filter((t) => t.exempt).length,
      };
    };
    const sale = agg('SALE');
    const purchase = agg('PURCHASE');
    const netVat = (BigInt(sale.vat) - BigInt(purchase.vat)).toString();
    return { data: { taxYear, quarter, status: period.status, exists: true, sale, purchase, netVat } };
  }

  /** فایل استاندارد CSV (UTF-8 BOM — سازگار Excel فارسی) */
  async exportCsv(taxYear: number, quarter: number): Promise<string> {
    const period = await this.prisma.quarterlyPeriod.findUnique({
      where: { taxYear_quarter: { taxYear, quarter } },
      include: { txs: { orderBy: { txDate: 'asc' } } },
    });
    const cols = this.csvColumns();
    const lines = [cols.join(',')];
    (period?.txs ?? []).forEach((t, i) => {
      const cells = [
        String(i + 1),
        t.txType === 'SALE' ? 'فروش' : 'خرید',
        t.counterpartyTin,
        this.csvCell(t.counterpartyName),
        t.amountRials.toString(),
        t.vatRials.toString(),
        t.exempt ? 'بله' : 'خیر',
        toJalaliStr(t.txDate),
        t.docRef,
        t.sourceType === 'POS' ? 'POS' : 'دستی',
        this.csvCell(t.notes),
      ];
      lines.push(cells.join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /** درخواست بستن فصل — نمونهٔ گردش کار تأیید می‌سازد؛ فصل با تأیید انسانی بسته می‌شود */
  async requestClose(input: { taxYear: number; quarter: number; userId: string; userPerms: Set<string> }) {
    const period = await this.ensurePeriod(input.taxYear, input.quarter);
    if (period.status !== 'OPEN') {
      throw new ConflictException({ code: 'CONFLICT', message: 'فصل قبلاً بسته شده است' });
    }
    // نمونهٔ در جریان موجود → همان (Idempotent)
    if (period.workflowInstanceId) {
      const inst = await this.prisma.workflowInstance.findUnique({ where: { id: period.workflowInstanceId } });
      if (inst && inst.status === 'IN_PROGRESS') return this.workflow.detail(inst.id);
    }
    const inst = await this.workflow.start({
      defCode: QUARTERLY_CLOSE_DEF,
      entityType: 'quarterly_period',
      entityId: period.id,
      title: `بستن فصل ${input.quarter} سال مالیاتی ${input.taxYear}`,
      userId: input.userId,
      userPerms: input.userPerms,
    });
    await this.prisma.quarterlyPeriod.update({
      where: { id: period.id },
      data: { workflowInstanceId: inst.data.id },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'QUARTERLY_CLOSE_REQUESTED', entity: 'QuarterlyPeriod', entityId: period.id, reason: `Q${input.quarter}/${input.taxYear}` },
    });
    return inst;
  }

  /** بازگشایی فصل — فقط admin */
  async reopen(input: { taxYear: number; quarter: number; userId: string; userPerms: Set<string> }) {
    if (!input.userPerms.has('workflow.manage')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'بازگشایی فصل فقط توسط مدیر سیستم' });
    }
    const period = await this.prisma.quarterlyPeriod.findUnique({
      where: { taxYear_quarter: { taxYear: input.taxYear, quarter: input.quarter } },
    });
    if (!period) throw new NotFoundException({ code: 'NOT_FOUND', message: 'فصل یافت نشد' });
    const updated = await this.prisma.quarterlyPeriod.update({
      where: { id: period.id },
      data: { status: 'OPEN', closedAt: null, closedById: null },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'QUARTERLY_REOPENED', entity: 'QuarterlyPeriod', entityId: period.id, reason: `Q${input.quarter}/${input.taxYear}` },
    });
    return { data: this.periodDto(updated) };
  }

  /** مصرف‌کنندهٔ workflow.completed — فصل را می‌بندد (تکرارپذیر) */
  private async handleCompleted(e: EventEnvelope<{ defCode?: string; entityId?: string; instanceId?: string }>): Promise<void> {
    try {
      if (e.payload?.defCode !== QUARTERLY_CLOSE_DEF || !e.payload.entityId) return;
      const period = await this.prisma.quarterlyPeriod.findUnique({ where: { id: e.payload.entityId } });
      if (!period || period.status === 'CLOSED') return; // idempotent
      const inst = await this.prisma.workflowInstance.findUnique({
        where: { id: e.payload.instanceId ?? '' },
        include: { actions: { orderBy: { at: 'asc' } } },
      });
      const approver = [...(inst?.actions ?? [])].reverse().find((a) => a.action === 'APPROVE')?.actorId ?? null;
      await this.prisma.quarterlyPeriod.update({
        where: { id: period.id },
        data: { status: 'CLOSED', closedAt: new Date(), closedById: approver },
      });
      await this.prisma.auditLog.create({
        data: { userId: approver, action: 'QUARTERLY_CLOSED', entity: 'QuarterlyPeriod', entityId: period.id, reason: `workflow ${e.payload.instanceId}` },
      });
      this.logger.log(`quarter closed via workflow: period=${period.id}`);
    } catch (err) {
      this.logger.error(`handleCompleted failed: ${String(err)}`);
      throw err; // Outbox تلاش مجدد می‌کند
    }
  }

  /** ستون‌های فایل استاندارد — پارامتریک برای هم‌ترازی با قالب ابلاغی سالانه */
  private csvColumns(): string[] {
    return [
      'ردیف', 'نوع معامله', 'شناسهٔ ملی/کد اقتصادی طرف معامله', 'نام طرف معامله',
      'مبلغ معامله (ریال)', 'مالیات بر ارزش افزوده (ریال)', 'معاف', 'تاریخ معامله (شمسی)',
      'مرجع سند', 'منبع', 'توضیحات',
    ];
  }

  private csvCell(v: string): string {
    return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replaceAll('"', '""')}"` : v;
  }

  private validatePeriodInput(taxYear: number, quarter: number): void {
    if (!Number.isInteger(taxYear) || taxYear < 1300 || taxYear > 1500) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'سال مالیاتی شمسی نامعتبر است' });
    }
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'فصل باید ۱ تا ۴ باشد' });
    }
  }

  private periodDto(r: {
    id: string; taxYear: number; quarter: number; status: string;
    workflowInstanceId: string | null; closedAt: Date | null; closedById: string | null;
  }) {
    return {
      id: r.id, taxYear: r.taxYear, quarter: r.quarter, status: r.status,
      workflowInstanceId: r.workflowInstanceId, closedAt: r.closedAt?.toISOString() ?? null,
      closedById: r.closedById,
    };
  }

  private txDto(r: {
    id: string; periodId: string; txType: string; counterpartyName: string; counterpartyTin: string;
    amountRials: bigint; vatRials: bigint; txDate: Date; exempt: boolean; sourceType: string;
    docRef: string; notes: string;
  }) {
    return {
      id: r.id, periodId: r.periodId, txType: r.txType, counterpartyName: r.counterpartyName,
      counterpartyTin: r.counterpartyTin, amountRials: r.amountRials.toString(),
      vatRials: r.vatRials.toString(), txDate: r.txDate.toISOString(), exempt: r.exempt,
      sourceType: r.sourceType, docRef: r.docRef, notes: r.notes,
    };
  }
}
