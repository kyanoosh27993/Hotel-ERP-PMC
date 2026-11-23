/**
 * event-journal-consumer.ts — مصرف‌کننده رویدادهای دامنه‌ای → موتور سند خودکار.
 * قاعده نگاشت از جدول event_journal_rules خوانده می‌شود (پارامتریک، بدون هاردکد در کد مصرف).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  EVENT_NAMES,
  type EventEnvelope,
  type EventName,
  type ReservationCancelledPayload,
  ReservationConfirmedPayload,
  type PosOrderServedPayload,
  type PayrollRunApprovedPayload,
  type TreasuryTransactionPostedPayload,
  type AssetDepreciationPostedPayload,
  type AncillaryOrderConfirmedPayload,
  type GrnReceivedPayload,
  type InventoryAdjustmentPostedPayload,
  type InventoryConsumptionPostedPayload,
  type NightAuditPostedPayload,
} from '@hotel-erp/contracts';
import { JournalService, SYSTEM_ENGINE_USER } from './journal.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';
import { subRials, addRials } from '@hotel-erp/shared';

interface RuleLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amountKind: 'total' | 'tax' | 'net' | 'gross' | 'insEmployee' | 'insEmployer' | 'insTotal';
}

@Injectable()
export class EventJournalConsumer implements OnModuleInit {
  private readonly logger = new Logger('EventJournalConsumer');

  constructor(
    private readonly outbox: OutboxService,
    private readonly journal: JournalService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // فاز ۸ / F8-T2 — هر رویداد اول از جدول نگاشت پارامتریک سند می‌سازد؛
    // اگر نگاشت فعال نداشت، هندلر اختصاصی (سناریوهای چندجهته) اجرا می‌شود.
    const bind = (name: EventName, handler: (e: EventEnvelope) => Promise<void>) =>
      this.outbox.on(name, async (e) => {
        if (await this.tryMapped(name, e)) return;
        await handler(e);
      });

    bind(EVENT_NAMES.RESERVATION_CONFIRMED, (e) => this.handleReservationConfirmed(e));
    bind(EVENT_NAMES.RESERVATION_CANCELLED, (e) => this.handleReservationCancelled(e));
    bind(EVENT_NAMES.POS_ORDER_SERVED, (e) => this.handlePosOrderServed(e));
    bind(EVENT_NAMES.PAYROLL_RUN_APPROVED, (e) => this.handlePayrollRunApproved(e));
    // موج ۱ — فاز ۵ و ۱۰
    bind(EVENT_NAMES.TREASURY_TRANSACTION_POSTED, (e) => this.handleTreasuryTransaction(e));
    bind(EVENT_NAMES.ASSET_DEPRECIATION_POSTED, (e) => this.handleAssetDepreciation(e));
    bind(EVENT_NAMES.ANCILLARY_ORDER_CONFIRMED, (e) => this.handleAncillaryOrder(e));
    // موج ۲ — فاز ۷ (خرید/انبار/کاست کنترل)
    bind(EVENT_NAMES.GRN_RECEIVED, (e) => this.handleGrnReceived(e));
    bind(EVENT_NAMES.INVENTORY_ADJUSTMENT_POSTED, (e) => this.handleInventoryAdjustment(e));
    bind(EVENT_NAMES.INVENTORY_CONSUMPTION_POSTED, (e) => this.handleInventoryConsumption(e));
    // شارژ شب حسابرسی شبانه → بدهکار حساب مهمان / بستانکار درآمد اتاق
    bind(EVENT_NAMES.NIGHT_AUDIT_POSTED, (e) => this.handleNightAuditPosted(e));
  }

  /**
   * فاز ۸ / F8-T2 — سند خودکار از جدول نگاشت پارامتریک.
   * مبلغ از فیلد payload (amountField)، دو سطر debit/credit از نگاشت،
   * شرح از الگو با جایگذاری {فیلدها} و مرکز هزینهٔ پارامتریک.
   * در صورت نبود نگاشت فعال یا مبلغ صفر → false (هندلر اختصاصی).
   */
  private async tryMapped(eventName: EventName, envelope: EventEnvelope): Promise<boolean> {
    const mapping = await this.prisma.eventJournalMapping.findUnique({ where: { eventName } }).catch((err) => {
      this.logger.warn(`mapping lookup failed for ${eventName}: ${String(err)}`);
      return null;
    });
    if (!mapping || !mapping.active) {
      this.logger.warn(`mapping miss for ${eventName}: found=${!!mapping} active=${mapping?.active}`);
      return false;
    }

    const payload = (envelope.payload ?? {}) as Record<string, unknown>;
    const rawAmount = payload[mapping.amountField];
    const amount = BigInt(typeof rawAmount === 'number' ? Math.round(rawAmount) : Number(rawAmount ?? 0));
    if (!amount || amount <= 0n) {
      this.logger.warn(`mapping amount miss for ${eventName}: field=${mapping.amountField} raw=${String(rawAmount)}`);
      return false;
    }

    // شرح: جایگذاری {فیلد} با مقادیر payload (حداکثر ۳ جایگاه)
    let description = mapping.descriptionTemplate;
    for (const [k, v] of Object.entries(payload).slice(0, 8)) {
      if (description.includes(`{${k}}`)) description = description.replace(`{${k}}`, String(v));
    }
    description = description.replace(/\{[a-zA-Z]+\}/g, '').trim() || `Auto: ${eventName}`;

    const costCenter = mapping.costCenterCode ?? undefined;
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      [
        { accountCode: mapping.debitAccount, debitRials: amount, creditRials: 0n, ...(costCenter ? { costCenterCode: costCenter } : {}) },
        { accountCode: mapping.creditAccount, debitRials: 0n, creditRials: amount },
      ],
      {
        description: `${description} [mapping:v${mapping.version}]`,
        sourceModule: eventName.split('.')[0] ?? 'engine',
        sourceRef: envelope.idempotencyKey,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted via mapping v${mapping.version} for ${eventName} (${amount})`);
    return true;
  }

  /** pms.night_audit.posted → سند شارژ شب: بدهکار ۱۲۰۱ / بستانکار ۴۱۰۱ */
  private async handleNightAuditPosted(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as NightAuditPostedPayload;
    const amount = BigInt(payload.chargedRials);
    if (amount <= 0n) return;
    const lines = [
      { accountCode: '1201', debitRials: amount, creditRials: 0n },
      { accountCode: '4101', debitRials: 0n, creditRials: amount },
    ];
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: night audit room charge ${payload.businessDate}`,
        sourceModule: 'pms',
        sourceRef: payload.businessDate,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for night audit ${payload.businessDate} (${payload.chargedRials})`);
  }

  /** booking.reservation.confirmed → بدهکار حساب مهمان / بستانکار درآمد اتاق */
  private async handleReservationConfirmed(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as ReservationConfirmedPayload;
    const rule = await this.loadRule(EVENT_NAMES.RESERVATION_CONFIRMED);
    if (!rule) return;

    const total = BigInt(payload.totalAmountRials);
    const lines = rule.map((l) => ({
      accountCode: l.accountCode,
      debitRials: l.side === 'debit' ? total : 0n,
      creditRials: l.side === 'credit' ? total : 0n,
    }));

    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: reservation ${payload.reservationId} (${payload.nights} nights)`,
        sourceModule: 'booking',
        sourceRef: payload.reservationId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for reservation ${payload.reservationId}`);
  }

  /** booking.reservation.cancelled → سند معکوس رزرو (بستانکار حساب مهمان / بدهکار درآمد اتاق) */
  private async handleReservationCancelled(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as ReservationCancelledPayload;
    const rule = await this.loadRule(EVENT_NAMES.RESERVATION_CONFIRMED);
    if (!rule) return;

    const total = BigInt(payload.totalAmountRials);
    // معکوس رزرو: طرف‌های سند تأیید عوض می‌شوند
    const lines = rule.map((l) => ({
      accountCode: l.accountCode,
      debitRials: l.side === 'credit' ? total : 0n,
      creditRials: l.side === 'debit' ? total : 0n,
    }));

    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: cancellation of reservation ${payload.reservationId}`,
        sourceModule: 'booking',
        sourceRef: `cancel:${payload.reservationId}`,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`cancellation journal posted for reservation ${payload.reservationId}`);
  }

  /**
   * pos.order.served → سند سه‌خطی فروش:
   * بدهکار صندوق (۱۱۰۱) در فروش نقدی یا حساب مهمان (۱۲۰۱) در شارژ اتاق/روم‌سرویس؛
   * بستانکار درآمد رستوران + بستانکار مالیات ارزش افزوده.
   */
  private async handlePosOrderServed(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as PosOrderServedPayload;
    const rule = await this.loadRule(EVENT_NAMES.POS_ORDER_SERVED);
    if (!rule) return;

    const total = BigInt(payload.totalAmountRials);
    const tax = BigInt(payload.taxAmountRials);
    const net = subRials(total, tax);
    const amountFor = (kind: RuleLine['amountKind']): bigint =>
      kind === 'total' ? total : kind === 'tax' ? tax : net;
    // شارژ اتاق/روم‌سرویس: بدهکار از صندوق به حساب دریافتنی مهمان تغییر می‌کند
    const debitAccountOverride = payload.folioId ? '1201' : null;

    const lines = rule.map((l) => ({
      accountCode: debitAccountOverride && l.side === 'debit' ? debitAccountOverride : l.accountCode,
      debitRials: l.side === 'debit' ? amountFor(l.amountKind) : 0n,
      creditRials: l.side === 'credit' ? amountFor(l.amountKind) : 0n,
    }));

    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: POS order ${payload.orderNo}`,
        sourceModule: 'pos',
        sourceRef: payload.orderId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for POS order ${payload.orderNo}`);
  }

  /**
   * payroll.run.approved → سند حقوق:
   * بدهکار هزینه حقوق (ناخالص) + هزینه بیمه سهم کارفرما
   * بستانکار بیمه پرداختنی (۳۰٪) + مالیات حقوق + حقوق پرداختنی (خالص).
   * تراز: gross + insEmployer = insTotal + tax + net ✓
   */
  private async handlePayrollRunApproved(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as PayrollRunApprovedPayload;
    const rule = await this.loadRule(EVENT_NAMES.PAYROLL_RUN_APPROVED);
    if (!rule) return;

    const amounts: Record<RuleLine['amountKind'], bigint> = {
      total: 0n,
      tax: BigInt(payload.taxRials),
      net: BigInt(payload.netRials),
      gross: BigInt(payload.grossRials),
      insEmployee: BigInt(payload.insEmployeeRials),
      insEmployer: BigInt(payload.insEmployerRials),
      insTotal: addRials(payload.insEmployeeRials, payload.insEmployerRials),
    };

    const lines = rule.map((l) => ({
      accountCode: l.accountCode,
      debitRials: l.side === 'debit' ? amounts[l.amountKind] : 0n,
      creditRials: l.side === 'credit' ? amounts[l.amountKind] : 0n,
    }));

    const result = await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: payroll ${payload.periodCode} (${payload.employeeCount} slips)`,
        sourceModule: 'payroll',
        sourceRef: payload.runId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );

    // پیوند دوطرفه برای ردیابی (قاعده ۱۱: هر تراکنش قابل ردیابی به منبع)
    await this.prisma.payrollRun.update({ where: { id: payload.runId }, data: { journalEntryId: result.id } });
    this.logger.log(`journal posted for payroll ${payload.periodCode} → ${result.entryNo}`);
  }

  /** انواع تراکنش خزانه با جهت ورود وجه (مبلغ همیشه مثبت) */
  private static readonly TREASURY_INFLOW = new Set(['RECEIPT', 'TRANSFER', 'ADJUSTMENT']);

  /**
   * treasury.transaction.posted → سند خزانه:
   * طرف صندوق از کد حساب کل متصل به صندوق در payload؛ طرف مقابل از تراکنش (counterGlAccountCode).
   */
  private async handleTreasuryTransaction(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as TreasuryTransactionPostedPayload;
    const txn = await this.prisma.cashTransaction.findUnique({ where: { id: payload.txnId } });
    if (!txn || txn.status !== 'POSTED') {
      this.logger.warn(`treasury txn ${payload.txnNo} missing/void — no entry`);
      return;
    }
    const amount = BigInt(payload.amountRials);
    const inflow = EventJournalConsumer.TREASURY_INFLOW.has(payload.kind);
    const lines = [
      {
        accountCode: payload.cashGlAccountCode,
        debitRials: inflow ? amount : 0n,
        creditRials: inflow ? 0n : amount,
      },
      {
        accountCode: txn.counterGlAccountCode ?? '9901',
        debitRials: inflow ? 0n : amount,
        creditRials: inflow ? amount : 0n,
      },
    ];
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: treasury ${payload.txnNo} ${payload.kind} ${payload.method}`,
        sourceModule: 'treasury',
        sourceRef: payload.txnId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for treasury txn ${payload.txnNo}`);
  }

  /** assets.depreciation.posted → بدهکار هزینهٔ استهلاک / بستانکار استهلاک انباشته (کدها از پروندهٔ دارایی) */
  private async handleAssetDepreciation(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as AssetDepreciationPostedPayload;
    const asset = await this.prisma.fixedAsset.findUnique({ where: { id: payload.assetId } });
    if (!asset) {
      this.logger.warn(`asset ${payload.assetCode} not found — depreciation entry skipped`);
      return;
    }
    const amount = BigInt(payload.depreciationRials);
    const lines = [
      { accountCode: asset.glDepExpenseAccountCode, debitRials: amount, creditRials: 0n },
      { accountCode: asset.glAccDepAccountCode, debitRials: 0n, creditRials: amount },
    ];
    const result = await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: depreciation ${payload.assetCode} ${payload.periodCode}`,
        sourceModule: 'assets',
        sourceRef: `${payload.assetCode}:${payload.periodCode}`,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    // پیوند سند برای گزارش استهلاک
    await this.prisma.assetDepreciation.updateMany({
      where: { assetId: payload.assetId, periodCode: payload.periodCode },
      data: { journalEntryNo: result.entryNo },
    });
    this.logger.log(`journal posted for depreciation ${payload.assetCode} ${payload.periodCode}`);
  }

  /**
   * ancillary.order.confirmed → سند سه‌خطی خدمات جانبی:
   * بدهکار حساب مهمان (۱۲۰۱) در شارژ اتاق یا صندوق (۱۱۰۱) در فروش مستقل؛
   * بستانکار درآمد خدمات (از کاتالوگ) + بستانکار مالیات فروش (۲۲۰۱). تراز: net + tax = total ✓
   */
  private async handleAncillaryOrder(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as AncillaryOrderConfirmedPayload;
    const order = await this.prisma.ancillaryOrder.findUnique({
      where: { id: payload.orderId },
      include: { service: { select: { glRevenueAccountCode: true } } },
    });
    if (!order || order.status !== 'CONFIRMED') {
      this.logger.warn(`ancillary order ${payload.orderNo} missing/canceled — no entry`);
      return;
    }
    const net = BigInt(payload.netRials);
    const tax = BigInt(payload.taxRials);
    const total = BigInt(payload.totalRials);
    const lines = [
      { accountCode: payload.stayCode ? '1201' : '1101', debitRials: total, creditRials: 0n },
      { accountCode: order.service.glRevenueAccountCode, debitRials: 0n, creditRials: net },
      { accountCode: '2201', debitRials: 0n, creditRials: tax },
    ];
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: ancillary ${payload.orderNo} (${payload.category} ×${payload.quantity})`,
        sourceModule: 'ancillary',
        sourceRef: payload.orderId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for ancillary order ${payload.orderNo}`);
  }

  /**
   * procurement.grn.received → سند رسید خرید:
   * بدهکار موجودی مواد (۱۳۰۱) + بدهکار مالیات خرید (۲۲۰۴) / بستانکار تأمین‌کننده (کد ledger).
   * تراز: net + tax = total ✓
   */
  private async handleGrnReceived(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as GrnReceivedPayload;
    const net = BigInt(payload.netRials);
    const tax = BigInt(payload.taxRials);
    const total = BigInt(payload.totalRials);
    const lines = [
      { accountCode: '1301', debitRials: net, creditRials: 0n },
      { accountCode: '2204', debitRials: tax, creditRials: 0n },
      { accountCode: payload.supplierLedgerCode, debitRials: 0n, creditRials: total },
    ];
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: GRN ${payload.grnNo} from ${payload.supplierCode} (PO ${payload.poNo})`,
        sourceModule: 'procurement',
        sourceRef: payload.grnId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for GRN ${payload.grnNo}`);
  }

  /**
   * inventory.adjustment.posted → سند اصلاحی انبارگردانی:
   * کسری: بدهکار هزینهٔ مغایرت (۵۱۰۴) / بستانکار موجودی؛ اضافه: عکس آن.
   */
  private async handleInventoryAdjustment(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as InventoryAdjustmentPostedPayload;
    const loss = BigInt(payload.lossRials);
    const gain = BigInt(payload.gainRials);
    const lines: Array<{ accountCode: string; debitRials: bigint; creditRials: bigint }> = [];
    if (loss > 0n) {
      lines.push({ accountCode: '5104', debitRials: loss, creditRials: 0n });
      lines.push({ accountCode: '1301', debitRials: 0n, creditRials: loss });
    }
    if (gain > 0n) {
      lines.push({ accountCode: '1301', debitRials: gain, creditRials: 0n });
      lines.push({ accountCode: '5104', debitRials: 0n, creditRials: gain });
    }
    if (lines.length === 0) return;
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: stock count ${payload.countNo} (${payload.warehouseCode}) loss=${payload.lossRials} gain=${payload.gainRials}`,
        sourceModule: 'stores',
        sourceRef: payload.countId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for stock count ${payload.countNo}`);
  }

  /** inventory.consumption.posted → سند COGS: بدهکار بهای فروش (۵۱۰۱) / بستانکار موجودی (۱۳۰۱) */
  private async handleInventoryConsumption(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as InventoryConsumptionPostedPayload;
    const amount = BigInt(payload.consumedRials);
    if (amount <= 0n) return;
    const lines = [
      { accountCode: '5101', debitRials: amount, creditRials: 0n },
      { accountCode: '1301', debitRials: 0n, creditRials: amount },
    ];
    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: recipe consumption ${payload.orderNo}`,
        sourceModule: 'stores',
        sourceRef: payload.orderId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for consumption ${payload.orderNo}`);
  }

  private async loadRule(eventName: string): Promise<RuleLine[] | null> {
    const row = await this.prisma.eventJournalRule.findUnique({ where: { eventName } });
    if (!row || !row.isActive) {
      this.logger.warn(`no active journal rule for ${eventName} — event left without entry`);
      return null;
    }
    return (typeof row.linesJson === 'string' ? JSON.parse(row.linesJson) : row.linesJson) as RuleLine[];
  }
}
