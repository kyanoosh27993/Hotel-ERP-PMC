/**
 * treasury.service.ts — فاز ۵ (موج ۱): صندوق‌ها، شیفت صندوق‌دار، تراکنش‌های دریافت/پرداخت،
 * مغایرت‌گیری بانکی. قواعد سند تحلیل docs/08-back-office/PHASE5-TREASURY.md:
 * پول فقط BigInt ریال مثبت (جهت با kind)؛ idempotencyKey یکتا؛ تراکنش نقدی فقط روی شیفت باز؛
 * رویداد treasury.transaction.posted با Outbox هم‌تراکنشی → سند خودکار دوطرفه.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CashTxnKind, CashTxnMethod } from '@prisma/client';
import { EVENT_NAMES, type TreasuryTransactionPostedPayload } from '@hotel-erp/contracts';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';

/** جهت جریان وجه هر نوع تراکنش (مبلغ همیشه مثبت ذخیره می‌شود) */
const INFLOW_KINDS: ReadonlySet<CashTxnKind> = new Set(['RECEIPT', 'TRANSFER', 'ADJUSTMENT']);

/** حساب طرف مقابل پیش‌فرض هر نوع (پارامتریک قابل override در DTO) */
const DEFAULT_COUNTER: Record<CashTxnKind, string> = {
  RECEIPT: '1201', // حساب‌های دریافتنی مهمانان
  TRANSFER: '1201',
  ADJUSTMENT: '9901', // حساب معلق (کاوشگر)
  PAYMENT: '2101', // حساب‌های پرداختنی تأمین‌کنندگان
  REFUND: '1201',
};

@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  async listAccounts() {
    const rows = await this.prisma.cashAccount.findMany({ orderBy: { code: 'asc' } });
    return rows.map((r) => this.mapAccount(r));
  }

  async openShift(input: {
    cashAccountId: string;
    openingFloatRials: number;
    businessDate: string;
    note?: string;
    userId?: string;
  }) {
    const opening = BigInt(input.openingFloatRials);
    if (opening < 0n) throw new BadRequestException('موجودی ابتدای شیفت نمی‌تواند منفی باشد');
    const account = await this.prisma.cashAccount.findUnique({ where: { id: input.cashAccountId } });
    if (!account || !account.active) throw new BadRequestException('صندوق/حساب نامعتبر است');
    const open = await this.prisma.cashierShift.findFirst({
      where: { cashAccountId: input.cashAccountId, status: 'OPEN' },
    });
    if (open) throw new ConflictException(`شیفت باز ${open.code} روی این صندوق وجود دارد — ابتدا ببندید`);

    return this.prisma.$transaction(async (tx) => {
      const seq = (await tx.cashierShift.count()) + 1;
      const shift = await tx.cashierShift.create({
        data: {
          code: `SHF-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          cashAccountId: input.cashAccountId,
          businessDate: new Date(input.businessDate),
          openingFloatRials: opening,
          note: input.note,
          openedById: input.userId,
        },
      });
      return { id: shift.id, code: shift.code, status: shift.status };
    });
  }

  /** جمع جریان ورودی/خروجی نقدی شیفت — مغایرتِ بستن شیفت از همین محاسبه می‌شود */
  private shiftFlow(shift: { openingFloatRials: bigint }, txns: Array<{ kind: CashTxnKind; amountRials: bigint }>): {
    inflowRials: bigint;
    outflowRials: bigint;
    expectedRials: bigint;
  } {
    let inflow = 0n;
    let outflow = 0n;
    for (const t of txns) {
      if (INFLOW_KINDS.has(t.kind)) inflow += t.amountRials;
      else outflow += t.amountRials;
    }
    return { inflowRials: inflow, outflowRials: outflow, expectedRials: shift.openingFloatRials + inflow - outflow };
  }

  async closeShift(input: { shiftId: string; countedRials: number; note?: string }) {
    const counted = BigInt(input.countedRials);
    return this.prisma.$transaction(async (tx) => {
      // قفل مشورتی سطر شیفت برای جلوگیری از بستن هم‌زمان
      await tx.$queryRaw`SELECT id FROM "cashier_shifts" WHERE id = ${input.shiftId}::uuid FOR UPDATE`;
      const shift = await tx.cashierShift.findUnique({ where: { id: input.shiftId } });
      if (!shift) throw new NotFoundException('شیفت یافت نشد');
      if (shift.status !== 'OPEN') throw new BadRequestException('این شیفت قبلاً بسته شده است');
      const txns = await tx.cashTransaction.findMany({
        where: { shiftId: shift.id, status: 'POSTED', method: 'CASH' },
        select: { kind: true, amountRials: true },
      });
      const flow = this.shiftFlow(shift, txns);
      const variance = counted - flow.expectedRials;
      const closed = await tx.cashierShift.update({
        where: { id: shift.id },
        data: { status: 'CLOSED', countedRials: counted, varianceRials: variance, closedAt: new Date(), note: input.note ?? shift.note },
      });
      return this.mapShift(closed);
    });
  }

  /** ثبت تراکنش خزانه — Idempotent؛ نقدی فقط روی شیفت باز؛ رویداد با Outbox هم‌تراکنشی */
  async postTransaction(input: {
    cashAccountId: string;
    kind: CashTxnKind;
    method: CashTxnMethod;
    amountRials: number;
    traceNo?: string | null;
    counterGlAccountCode?: string | null;
    stayId?: string | null;
    payerName?: string | null;
    note?: string | null;
    businessDate: string;
    idempotencyKey: string;
    userId?: string;
  }) {
    const amount = BigInt(input.amountRials);
    if (amount <= 0n) throw new BadRequestException('مبلغ باید ریال صحیح مثبت باشد');

    const replay = await this.prisma.cashTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { ...this.mapTxn(replay), replayed: true };

    const txn = await this.prisma.$transaction(async (tx) => {
      const account = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } });
      if (!account || !account.active) throw new BadRequestException('صندوق/حساب نامعتبر است');

      let shiftId: string | null = null;
      if (input.method === 'CASH') {
        // تراکنش نقدی فقط روی شیفت باز همان صندوق
        const shift = await tx.cashierShift.findFirst({
          where: { cashAccountId: input.cashAccountId, status: 'OPEN' },
        });
        if (!shift) throw new BadRequestException('برای تراکنش نقدی، شیفت باز روی این صندوق لازم است');
        shiftId = shift.id;
      }

      if (input.stayId) {
        const stay = await tx.stay.findUnique({ where: { id: input.stayId } });
        if (!stay || stay.status !== 'OPEN') throw new BadRequestException('اقامت باز برای شارژ فولیو یافت نشد');
      }

      const seq = (await tx.cashTransaction.count()) + 1;
      const row = await tx.cashTransaction.create({
        data: {
          txnNo: `TXN-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          cashAccountId: input.cashAccountId,
          shiftId,
          kind: input.kind,
          method: input.method,
          amountRials: amount,
          traceNo: input.traceNo ?? null,
          counterGlAccountCode: input.counterGlAccountCode ?? DEFAULT_COUNTER[input.kind],
          stayId: input.stayId ?? null,
          payerName: input.payerName ?? null,
          note: input.note ?? null,
          businessDate: new Date(input.businessDate),
          idempotencyKey: input.idempotencyKey,
          createdById: input.userId,
        },
      });

      const payload: TreasuryTransactionPostedPayload = {
        txnId: row.id,
        txnNo: row.txnNo,
        kind: row.kind,
        method: row.method,
        amountRials: Number(row.amountRials),
        cashAccountCode: account.code,
        cashGlAccountCode: account.glAccountCode,
        traceNo: row.traceNo,
        stayCode: null,
        businessDate: input.businessDate,
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.TREASURY_TRANSACTION_POSTED,
        aggregate: 'cash_transaction',
        idempotencyKey: `treasury.txn.${input.idempotencyKey}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'treasury',
      });
      return row;
    });
    return { ...this.mapTxn(txn), replayed: false };
  }

  /** ابطال تراکنش — حذف فیزیکی ممنوع؛ اصلاح حسابداری با سند برگشتی جدا انجام می‌شود */
  async voidTransaction(txnId: string, reason: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "cash_transactions" WHERE id = ${txnId}::uuid FOR UPDATE`;
      const row = await tx.cashTransaction.findUnique({ where: { id: txnId } });
      if (!row) throw new NotFoundException('تراکنش یافت نشد');
      if (row.status !== 'POSTED') throw new BadRequestException('این تراکنش قبلاً باطل شده است');
      if (!reason || reason.trim().length < 3) throw new BadRequestException('دلیل ابطال الزامی است');
      const updated = await tx.cashTransaction.update({
        where: { id: txnId },
        data: { status: 'VOID', note: `${row.note ? row.note + ' | ' : ''}VOID: ${reason}`, createdById: row.createdById ?? userId },
      });
      return this.mapTxn(updated);
    });
  }

  /** ورود سطر صورت‌حساب بانک — idempotent با کلید (حساب، شمارهٔ سند بانک) */
  async addStatementLine(input: {
    cashAccountId: string;
    valueDate: string;
    externalRef: string;
    description: string;
    debitRials: number;
    creditRials: number;
    userId?: string;
  }) {
    const debit = BigInt(input.debitRials);
    const credit = BigInt(input.creditRials);
    if (debit < 0n || credit < 0n || (debit > 0n && credit > 0n)) {
      throw new BadRequestException('هر سطر فقط یکی از بدهکار/بستانکار را می‌تواند داشته باشد');
    }
    const row = await this.prisma.bankStatementLine.upsert({
      where: { cashAccountId_externalRef: { cashAccountId: input.cashAccountId, externalRef: input.externalRef } },
      create: {
        cashAccountId: input.cashAccountId,
        valueDate: new Date(input.valueDate),
        externalRef: input.externalRef,
        description: input.description,
        debitRials: debit,
        creditRials: credit,
        createdById: input.userId,
      },
      update: { description: input.description, debitRials: debit, creditRials: credit },
    });
    return {
      id: row.id,
      cashAccountId: row.cashAccountId,
      valueDate: row.valueDate.toISOString().slice(0, 10),
      externalRef: row.externalRef,
      description: row.description,
      debitRials: Number(row.debitRials),
      creditRials: Number(row.creditRials),
      matched: row.matchedTxnId != null,
    };
  }

  /** اجرای مغایرت‌گیری: تطبیق سطر بانک با تراکنش‌های POSTED (traceNo دقیق، سپس مبلغ+پنجرهٔ تاریخ) */
  async runReconciliation(input: { cashAccountId: string; runDate: string; userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const lines = await tx.bankStatementLine.findMany({
        where: { cashAccountId: input.cashAccountId, matchedTxnId: null },
        orderBy: { valueDate: 'asc' },
      });
      const txns = await tx.cashTransaction.findMany({
        where: { cashAccountId: input.cashAccountId, status: 'POSTED', method: { not: 'CASH' } },
        orderBy: { businessDate: 'asc' },
      });
      let matched = 0;
      const used = new Set<string>();
      for (const line of lines) {
        const lineAmount = line.debitRials > 0n ? line.debitRials : line.creditRials;
        // قاعدهٔ ۱: شمارهٔ پیگیری دقیق
        let hit = line.debitRials > 0n
          ? txns.find((t) => t.traceNo === line.externalRef && !used.has(t.id) && t.kind === 'PAYMENT' && t.amountRials === lineAmount)
          : txns.find((t) => t.traceNo === line.externalRef && !used.has(t.id) && INFLOW_KINDS.has(t.kind) && t.amountRials === lineAmount);
        // قاعدهٔ ۲: مبلغ برابر و تاریخ در پنجرهٔ ±۳ روز
        if (!hit) {
          const from = new Date(line.valueDate.getTime() - 3 * 86400000);
          const to = new Date(line.valueDate.getTime() + 3 * 86400000);
          hit = txns.find((t) => !used.has(t.id) && t.amountRials === lineAmount
            && t.businessDate >= from && t.businessDate <= to
            && (line.creditRials > 0n ? INFLOW_KINDS.has(t.kind) : t.kind === 'PAYMENT'));
        }
        if (hit) {
          used.add(hit.id);
          await tx.bankStatementLine.update({
            where: { id: line.id },
            data: { matchedTxnId: hit.id, matchedAt: new Date() },
          });
          matched += 1;
        }
      }
      const run = await tx.reconciliationRun.create({
        data: {
          cashAccountId: input.cashAccountId,
          runDate: new Date(input.runDate),
          matchedCount: matched,
          unmatchedCount: lines.length - matched,
          closedById: input.userId,
        },
      });
      return { id: run.id, matched: run.matchedCount, unmatched: run.unmatchedCount, totalLines: lines.length };
    });
  }

  async reconciliationSummary(limit = 20) {
    const rows = await this.prisma.reconciliationRun.findMany({
      orderBy: { closedAt: 'desc' },
      take: limit,
      include: { cashAccount: { select: { code: true, nameFa: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      account: r.cashAccount.code,
      accountName: r.cashAccount.nameFa,
      runDate: r.runDate.toISOString().slice(0, 10),
      matched: r.matchedCount,
      unmatched: r.unmatchedCount,
    }));
  }

  async listTransactions(filter: { cashAccountId?: string; kind?: string; status?: string; limit?: number }) {
    const rows = await this.prisma.cashTransaction.findMany({
      where: {
        ...(filter.cashAccountId ? { cashAccountId: filter.cashAccountId } : {}),
        ...(filter.kind ? { kind: filter.kind as CashTxnKind } : {}),
        ...(filter.status ? { status: filter.status as 'POSTED' | 'VOID' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
      include: {
        cashAccount: { select: { code: true, nameFa: true } },
        stay: { select: { code: true, guestName: true } },
      },
    });
    return rows.map((r) => ({
      ...this.mapTxn(r),
      account: r.cashAccount.code,
      accountName: r.cashAccount.nameFa,
      stayCode: r.stay?.code ?? null,
      guestName: r.stay?.guestName ?? null,
    }));
  }

  async listShifts(limit = 50) {
    const rows = await this.prisma.cashierShift.findMany({
      orderBy: { openedAt: 'desc' },
      take: limit,
      include: { cashAccount: { select: { code: true, nameFa: true } } },
    });
    return rows.map((s) => ({ ...this.mapShift(s), account: s.cashAccount.code, accountName: s.cashAccount.nameFa }));
  }

  /** موجودی دفتری هر حساب = مجموع جهت‌دار تراکنش‌های POSTED (برای نمایش و مغایرت شیفت) */
  async accountBalances() {
    const rows = await this.prisma.cashAccount.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      include: { transactions: { where: { status: 'POSTED' }, select: { kind: true, amountRials: true } } },
    });
    return rows.map((a) => {
      const { inflowRials, outflowRials } = this.shiftFlow({ openingFloatRials: 0n }, a.transactions);
      return {
        ...this.mapAccount(a),
        balanceRials: Number(inflowRials - outflowRials),
      };
    });
  }

  private mapAccount(r: { id: string; code: string; nameEn: string; nameFa: string; kind: string; glAccountCode: string; active: boolean }) {
    return { id: r.id, code: r.code, nameEn: r.nameEn, nameFa: r.nameFa, kind: r.kind, glAccountCode: r.glAccountCode, active: r.active };
  }

  private mapShift(r: { id: string; code: string; businessDate: Date; openingFloatRials: bigint; countedRials: bigint | null; varianceRials: bigint | null; status: string; closedAt: Date | null }) {
    return {
      id: r.id,
      code: r.code,
      businessDate: r.businessDate.toISOString().slice(0, 10),
      openingFloatRials: Number(r.openingFloatRials),
      countedRials: r.countedRials == null ? null : Number(r.countedRials),
      varianceRials: r.varianceRials == null ? null : Number(r.varianceRials),
      status: r.status,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    };
  }

  private mapTxn(r: { id: string; txnNo: string; kind: string; method: string; amountRials: bigint; traceNo: string | null; counterGlAccountCode: string | null; payerName: string | null; note: string | null; businessDate: Date; status: string; idempotencyKey: string }) {
    return {
      id: r.id,
      txnNo: r.txnNo,
      kind: r.kind,
      method: r.method,
      amountRials: Number(r.amountRials),
      traceNo: r.traceNo,
      counterGlAccountCode: r.counterGlAccountCode,
      payerName: r.payerName,
      note: r.note,
      businessDate: r.businessDate.toISOString().slice(0, 10),
      status: r.status,
      idempotencyKey: r.idempotencyKey,
    };
  }
}
