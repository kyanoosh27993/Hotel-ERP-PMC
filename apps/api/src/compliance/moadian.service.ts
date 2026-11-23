/**
 * moadian.service.ts — فاز ۹ / F9-T2: ادغام سامانه مؤدیان (صورتحساب الکترونیکی).
 *
 * جریان: سند فروش قطعی (POSTED) → تولید صورتحساب (header+body از خطوط سند) → QUEUED + درج در
 * Outbox در همان تراکنش → کارگر ارسال (هندلر رویداد INVOICE_QUEUED) → فراخوانی Adapter →
 * ACCEPTED+uid یا FAILED+lastError (تلاش مجدد نمایی توسط Outbox). لغو = پاکت استورنو (تأییدکننده).
 *
 * قواعد طلایی: تولید از سند قطعی فقط؛ ارسال idempotent (کلید = شماره صورتحساب)؛
 * لغو فقط برای ACCEPTED و یک‌بار؛ قطع adapter → داده در صف می‌ماند و گم نمی‌شود.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EVENT_NAMES, type EventEnvelope } from '@hotel-erp/contracts';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { nextDocSeq } from '../common/doc-seq';
import { MoadianPacket, MoadianSimAdapter } from './moadian.adapter';

const REVENUE_ACCOUNTS = ['4101', '4102', '4103']; // درآمد اتاق/رستوران/خدمات جانبی
const OUTPUT_VAT_ACCOUNT = '2201'; // مالیات بر ارزش افزوده پرداختنی (بستانکار فروش)

@Injectable()
export class MoadianService implements OnModuleInit {
  private readonly logger = new Logger('MoadianService');

  // شناسه یکتای مالیاتی فروشنده (هتل) — از قانون LAW-MOADIAN-CONFIG خوانده می‌شود
  private sellerTaxId = '140000000000'; // پیش‌فرض نمونه (۱۱ رقمی) — seed قانون آن را پوش می‌کند

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly adapter: MoadianSimAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    // بارگذاری شناسهٔ مالیاتی فروشنده از کتابخانهٔ قوانین (در صورت وجود)
    try {
      const law = await this.prisma.lawRule.findUnique({ where: { code: 'LAW-MOADIAN-CONFIG' } });
      if (law) {
        const params = law.params as Record<string, unknown>;
        if (typeof params.sellerTaxId === 'string') this.sellerTaxId = params.sellerTaxId;
      }
    } catch {
      /* در تست بدون seed خاموش */
    }
    // کارگر ارسال: هندلر رویداد INVOICE_QUEUED → فراخوانی adapter با تلاش مجدد Outbox
    this.outbox.on(EVENT_NAMES.INVOICE_QUEUED, (e) => this.handleQueued(e as EventEnvelope<{ invoiceId: string }>));
    this.logger.log(`sellerTaxId=${this.sellerTaxId}; outbox handler registered for compliance.invoice.queued`);
  }

  /** تولید صورتحساب از سند فروش قطعی — Idempotent (همان journalEntryId → همان صورتحساب) */
  async generate(input: {
    journalEntryId: string;
    buyerTaxId?: string;
    buyerName?: string;
    userId: string;
  }) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: input.journalEntryId },
      include: { lines: true },
    });
    if (!entry) throw new NotFoundException({ code: 'NOT_FOUND', message: 'سند حسابداری یافت نشد' });
    if (entry.status !== 'POSTED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'تنها سند قطعی (POSTED) می‌تواند صورتحساب شود' });
    }
    const vatLine = entry.lines.find((l) => l.accountCode === OUTPUT_VAT_ACCOUNT && l.creditRials > 0n);
    if (!vatLine) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'سند خط مالیات فروش (۲۲۰۱ بستانکار) ندارد — صورتحساب فقط برای اسناد فروش' });
    }

    // Idempotency: اگر قبلاً برای این سند تولید شده، همان را برگردان
    const existing = await this.prisma.moadianInvoice.findFirst({
      where: { journalEntryId: input.journalEntryId },
    });
    if (existing) return this.toDto(existing);

    // ساخت بدنه از خطوط درآمد (هر سطر یک قلم صورتحساب)
    const revenueLines = entry.lines.filter((l) => REVENUE_ACCOUNTS.includes(l.accountCode));
    const body = revenueLines.map((l) => {
      const net = l.creditRials - l.debitRials; // خالص قلم (بستانکار منهای بدهکار)
      const vatRateBps = net > 0n && vatLine.creditRials > 0n
        ? Math.round((Number(vatLine.creditRials) / Number(net)) * 10000)
        : 0;
      const vatForLine = net > 0n
        ? (net * vatLine.creditRials) / (revenueLines.reduce((a, r) => a + (r.creditRials - r.debitRials), 0n) || 1n)
        : 0n;
      return {
        description: `درآمد حساب ${l.accountCode}`,
        quantity: 1,
        unitPriceRials: net.toString(),
        totalRials: net.toString(),
        vatRateBps,
        vatRials: vatForLine.toString(),
        revenueAccountCode: l.accountCode,
      };
    });

    const totalRials = revenueLines.reduce((a, l) => a + (l.creditRials - l.debitRials), 0n);
    const vatRials = vatLine.creditRials;
    const issueDate = entry.postingDate;

    const created = await this.prisma.$transaction(async (tx) => {
      const seq = await nextDocSeq(tx, 'invoice_number');
      const yy = String(new Date(issueDate).getFullYear());
      const invoiceNumber = `INV-${yy.slice(-2)}-${String(seq).padStart(6, '0')}`;
      const idempotencyKey = `moadian:${invoiceNumber}`;

      const header = {
        invoiceNumber,
        sellerTaxId: this.sellerTaxId,
        buyerTaxId: input.buyerTaxId ?? '',
        buyerName: input.buyerName ?? '',
        issueDate: issueDate.toISOString().slice(0, 10),
        totalRials: totalRials.toString(),
        vatRials: vatRials.toString(),
        discountRials: '0',
      };

      const inv = await tx.moadianInvoice.create({
        data: {
          invoiceNumber,
          journalEntryId: input.journalEntryId,
          sellerTaxId: this.sellerTaxId,
          buyerTaxId: input.buyerTaxId ?? '',
          buyerName: input.buyerName ?? '',
          issueDate,
          status: 'QUEUED',
          header: header as never,
          body: body as never,
          totalRials,
          vatRials,
          discountRials: 0n,
          idempotencyKey,
        },
      });

      // درج رویداد در همان تراکنش → کارگر ارسال آن را drain می‌کند
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.INVOICE_QUEUED,
        aggregate: `moadian:${inv.id}`,
        idempotencyKey: `queue:${inv.id}`,
        producer: 'compliance',
        payload: { invoiceId: inv.id, invoiceNumber, journalEntryId: input.journalEntryId },
      });

      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'MOADIAN_INVOICE_GENERATED',
          entity: 'MoadianInvoice',
          entityId: inv.id,
          reason: invoiceNumber,
        },
      });

      return inv;
    });

    return this.toDto(created);
  }

  /** کارگر ارسال: با هر drain یک بار فراخوانی می‌شود؛ idempotent (re-send همان uid) */
  async handleQueued(e: EventEnvelope<{ invoiceId: string }>): Promise<void> {
    const inv = await this.prisma.moadianInvoice.findUnique({ where: { id: e.payload.invoiceId } });
    if (!inv) return;
    if (inv.status === 'ACCEPTED' || inv.status === 'CANCELLED') return; // قبلاً قطعی شده

    const packet: MoadianPacket = {
      header: inv.header as never,
      body: inv.body as never,
      idempotencyKey: inv.idempotencyKey,
    };

    try {
      const res = await this.adapter.submit(packet);
      await this.prisma.moadianInvoice.update({
        where: { id: inv.id },
        data: {
          status: res.status === 'ACCEPTED' ? 'ACCEPTED' : res.status,
          uid: res.uid,
          submittedAt: new Date(res.at),
          attempts: { increment: 1 },
          lastResponse: { status: res.status, at: res.at } as never,
          lastError: null,
        },
      });
      this.logger.log(`invoice ${inv.invoiceNumber} → ${res.status} uid=${res.uid}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.moadianInvoice.update({
        where: { id: inv.id },
        data: {
          status: 'QUEUED', // در صف می‌ماند تا تلاش مجدد Outbox
          attempts: { increment: 1 },
          lastError: msg,
        },
      });
      this.logger.warn(`invoice ${inv.invoiceNumber} send failed: ${msg} — will retry via outbox`);
      throw err; // برای تلاش مجدد Outbox
    }
  }

  async list(filters: { status?: string; from?: string; to?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.issueDate = {};
      if (filters.from) (where.issueDate as Record<string, unknown>).gte = new Date(`${filters.from}T00:00:00Z`);
      if (filters.to) (where.issueDate as Record<string, unknown>).lte = new Date(`${filters.to}T23:59:59Z`);
    }
    const rows = await this.prisma.moadianInvoice.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { data: rows.map((r) => this.toDto(r)), count: rows.length };
  }

  async get(id: string) {
    const inv = await this.prisma.moadianInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'صورتحساب یافت نشد' });
    return { data: this.toDto(inv) };
  }

  /** وضعیت زنده از adapter (poll) */
  async liveStatus(id: string) {
    const inv = await this.prisma.moadianInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'صورتحساب یافت نشد' });
    if (!inv.uid) return { data: { localStatus: inv.status, sandboxStatus: null, uid: null } };
    const sandboxStatus = await this.adapter.status(inv.uid);
    return { data: { localStatus: inv.status, sandboxStatus, uid: inv.uid } };
  }

  /** تلاش مجدد دستی صورتحساب ناموفق — دوباره در صف می‌گذارد */
  async retry(id: string, userId: string) {
    const inv = await this.prisma.moadianInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'صورتحساب یافت نشد' });
    if (inv.status === 'ACCEPTED' || inv.status === 'CANCELLED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'صورتحساب قبلاً قطعی شده — تلاش مجدد معنی ندارد' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.moadianInvoice.update({ where: { id }, data: { lastError: null } });
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.INVOICE_QUEUED,
        aggregate: `moadian:${inv.id}`,
        idempotencyKey: `queue-retry:${inv.id}:${Date.now()}`,
        producer: 'compliance',
        payload: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, manualRetry: true },
      });
      await tx.auditLog.create({
        data: { userId, action: 'MOADIAN_INVOICE_RETRY', entity: 'MoadianInvoice', entityId: inv.id, reason: inv.invoiceNumber },
      });
    });
    return { data: { id, retried: true } };
  }

  /** لغو/استورنو — فقط ACCEPTED، یک‌بار، با دلیل اجباری (تأییدکننده) */
  async cancel(id: string, reason: string, userId: string) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'دلیل لغو صورتحساب اجباری است' });
    }
    const inv = await this.prisma.moadianInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'صورتحساب یافت نشد' });
    if (inv.status === 'CANCELLED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'صورتحساب قبلاً لغو شده است' });
    }
    if (inv.status !== 'ACCEPTED') {
      throw new ConflictException({ code: 'CONFLICT', message: 'تنها صورتحساب پذیرفته‌شده (ACCEPTED) قابل لغو است' });
    }

    const res = await this.adapter.cancel(inv.uid!, reason, `cancel:${inv.invoiceNumber}`);
    const updated = await this.prisma.moadianInvoice.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(res.at),
        cancelReason: reason,
        lastResponse: { status: res.status, at: res.at, reason } as never,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'MOADIAN_INVOICE_CANCELLED', entity: 'MoadianInvoice', entityId: inv.id, reason: `${inv.invoiceNumber}: ${reason}` },
    });
    return { data: this.toDto(updated) };
  }

  private toDto(r: {
    id: string; invoiceNumber: string; journalEntryId: string; sellerTaxId: string;
    buyerTaxId: string; buyerName: string; issueDate: Date; status: string;
    header: unknown; body: unknown; totalRials: bigint; vatRials: bigint; discountRials: bigint;
    uid: string | null; idempotencyKey: string; attempts: number; lastError: string | null;
    lastResponse: unknown; submittedAt: Date | null; cancelledAt: Date | null; cancelReason: string | null;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: r.id, invoiceNumber: r.invoiceNumber, journalEntryId: r.journalEntryId,
      sellerTaxId: r.sellerTaxId, buyerTaxId: r.buyerTaxId, buyerName: r.buyerName,
      issueDate: r.issueDate.toISOString().slice(0, 10), status: r.status,
      header: r.header, body: r.body,
      totalRials: r.totalRials.toString(), vatRials: r.vatRials.toString(), discountRials: r.discountRials.toString(),
      uid: r.uid, idempotencyKey: r.idempotencyKey, attempts: r.attempts, lastError: r.lastError,
      lastResponse: r.lastResponse, submittedAt: r.submittedAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    };
  }
}
