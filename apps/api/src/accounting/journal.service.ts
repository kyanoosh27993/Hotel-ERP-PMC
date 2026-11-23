/**
 * journal.service.ts — هسته سند دوطرفه (قواعد مالی قرارداد بخش ۴):
 * سند همیشه متوازن | ثبت اتمیک | inbox تکرارپذیر | قفل دوره | سند قطعی حذف فیزیکی ندارد.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { nextDocSeq } from '../common/doc-seq';
import { addRials, isBalanced } from '@hotel-erp/shared';
import { randomUUID } from 'node:crypto';

export interface JournalLineInput {
  accountCode: string;
  debitRials: bigint;
  creditRials: bigint;
  costCenterCode?: string | null;
}

export interface PostEntryMeta {
  description: string;
  sourceModule: string;
  sourceRef: string;
  sourceEventId?: string;
  createdByUserId: string;
  /** تاریخ سند (پیش‌فرض: اکنون) — برای قفل دوره و تست */
  entryDate?: Date;
}

@Injectable()
export class JournalService {
  private readonly logger = new Logger('Journal');

  constructor(private readonly prisma: PrismaService) {}

  /** صحت‌سنجی خالص تراز — قابل تست واحد بدون DB */
  static validateBalanced(lines: JournalLineInput[]): void {
    if (lines.length === 0) throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'Entry must have at least one line' });
    const debits = lines.filter((l) => l.debitRials > 0n).map((l) => l.debitRials);
    const credits = lines.filter((l) => l.creditRials > 0n).map((l) => l.creditRials);
    if (!isBalanced(debits, credits)) {
      throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'Debits and credits do not balance' });
    }
    for (const l of lines) {
      if (l.debitRials > 0n && l.creditRials > 0n) {
        throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'A line cannot be both debit and credit' });
      }
      if (l.debitRials < 0n || l.creditRials < 0n) {
        throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'Negative amounts are not allowed' });
      }
    }
  }

  /**
   * ثبت سند از رویداد دامنه‌ای — idempotent با inboxKey (کلید = شناسه رویداد).
   * تکرار فراخوانی با همان inboxKey → بدون اثر جانبی، همان سند بازگردانده می‌شود.
   */
  async postEntryFromEvent(
    inboxKey: string,
    lines: JournalLineInput[],
    meta: PostEntryMeta,
  ): Promise<{ entryNo: string; id: string; replayed: boolean }> {
    JournalService.validateBalanced(lines);

    const existing = await this.prisma.inboxEvent.findUnique({
      where: { idempotencyKey: inboxKey },
    });
    if (existing) {
      const result = existing.resultJson as { entryNo: string; id: string } | null;
      if (result) return { ...result, replayed: true };
    }

    return this.prisma.$transaction(async (tx) => {
      // قفل منطقی inbox داخل تراکنش (پیشگیری از دوباره‌کاری هم‌زمان)
      try {
        await tx.inboxEvent.create({ data: { idempotencyKey: inboxKey, eventName: meta.sourceModule } });
      } catch (e) {
        // رکورد هم‌زمان: بازخوانی نتیجه؛ در غیر این صورت همان خطا
        const concurrent = await tx.inboxEvent.findUnique({ where: { idempotencyKey: inboxKey } });
        if (concurrent) throw new ConflictException({ code: 'CONFLICT', message: 'Event already processed' });
        throw e;
      }

      const entryDate = meta.entryDate ?? new Date();
      const period = await this.findPeriod(tx, entryDate);
      if (period && period.status === 'LOCKED') {
        throw new ConflictException({ code: 'BUSINESS_RULE', message: `Fiscal period ${period.code} is locked` });
      }

      const accounts = await tx.account.findMany({
        where: { code: { in: lines.map((l) => l.accountCode) } },
      });
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      for (const l of lines) {
        if (!byCode.has(l.accountCode)) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: `Unknown account code: ${l.accountCode}` });
        }
      }

      const entryNo = await this.nextEntryNo(tx, entryDate);
      // فاز ۸ — شماره عطف قطعی در زمان ثبت (ترتیب دفاتر رسمی)
      const docIndex = await nextDocSeq(tx, 'journal_docindex');
      const entry = await tx.journalEntry.create({
        data: {
          entryNo,
          docIndex,
          entryDate,
          postingDate: entryDate,
          periodId: period?.id ?? null,
          description: meta.description,
          status: 'POSTED',
          sourceModule: meta.sourceModule,
          sourceRef: meta.sourceRef,
          sourceEventId: meta.sourceEventId ?? null,
          // موتور سیستمی کاربر DB نیست — createdById null و منبع در sourceModule/sourceRef
          createdById: meta.createdByUserId === SYSTEM_ENGINE_USER ? null : meta.createdByUserId,
          lines: {
            create: lines.map((l, i) => ({
              lineNo: i + 1,
              accountCode: l.accountCode,
              debitRials: l.debitRials,
              creditRials: l.creditRials,
              costCenterCode: l.costCenterCode ?? null,
            })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: meta.createdByUserId === 'system:engine' ? null : meta.createdByUserId,
          action: 'JOURNAL_POSTED_AUTO',
          entity: 'JournalEntry',
          entityId: entry.id,
          reason: `event:${meta.sourceRef}`,
        },
      });

      const result = { entryNo: entry.entryNo, id: entry.id };
      await tx.inboxEvent.update({
        where: { idempotencyKey: inboxKey },
        data: { resultJson: result as unknown as import('@prisma/client').Prisma.InputJsonValue },
      });
      return { ...result, replayed: false };
    });
  }

  /** تأیید سند پیش‌نویس — فقط با مجوز journal.approve و توسط غیرِ ثبت‌کننده */
  async approveEntry(entryId: string, approverId: string, approverPerms: Set<string>): Promise<{ id: string; status: string }> {
    if (!approverPerms.has('journal.approve')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission for this action' });
    }
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
      if (!entry) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Entry not found' });
      if (entry.status !== 'DRAFT') throw new ConflictException({ code: 'CONFLICT', message: 'Only draft entries can be approved' });
      if (entry.createdById === approverId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Approver must differ from creator (self-approval forbidden)' });
      }
      JournalService.validateBalanced(
        entry.lines.map((l) => ({ accountCode: l.accountCode, debitRials: l.debitRials, creditRials: l.creditRials })),
      );
      const updated = await tx.journalEntry.update({
        where: { id: entryId },
        data: { status: 'POSTED', approvedById: approverId, approvedAt: new Date(), docIndex: await nextDocSeq(tx, 'journal_docindex') },
      });
      await tx.auditLog.create({
        data: { userId: approverId, action: 'JOURNAL_APPROVED', entity: 'JournalEntry', entityId: entryId },
      });
      return { id: updated.id, status: updated.status };
    });
  }

  /** برگشت سند قطعی — سند برگشتی جدید با خطوط معکوس؛ سند اصلی هرگز حذف نمی‌شود */
  async reverseEntry(entryId: string, userId: string, reason: string): Promise<{ id: string; entryNo: string }> {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'Reversal reason is required' });
    }
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
      if (!entry) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Entry not found' });
      if (entry.status === 'DRAFT') throw new ConflictException({ code: 'CONFLICT', message: 'Draft entries are edited, not reversed' });
      if (entry.status === 'REVERSED') throw new ConflictException({ code: 'CONFLICT', message: 'Entry is already reversed' });

      const entryNo = await this.nextEntryNo(tx, new Date());
      const reversed = await tx.journalEntry.create({
        data: {
          entryNo,
          entryDate: new Date(),
          postingDate: new Date(),
          periodId: entry.periodId,
          description: `Reversal of ${entry.entryNo}: ${reason}`.slice(0, 500),
          status: 'POSTED',
          sourceModule: 'accounting',
          sourceRef: `reverse:${entry.entryNo}`,
          reversedByEntryId: entry.id,
          createdById: userId,
          lines: {
            create: entry.lines.map((l, i) => ({
              lineNo: i + 1,
              accountCode: l.accountCode,
              debitRials: l.creditRials,
              creditRials: l.debitRials,
              costCenterCode: l.costCenterCode,
            })),
          },
        },
      });
      await tx.journalEntry.update({ where: { id: entryId }, data: { status: 'REVERSED' } });
      await tx.auditLog.create({
        data: { userId, action: 'JOURNAL_REVERSED', entity: 'JournalEntry', entityId: entryId, reason },
      });
      return { id: reversed.id, entryNo: reversed.entryNo };
    });
  }

  /** قفل/بازگشایی دوره مالی (قواعد مالی: کنترل‌شده) */
  async setPeriodLock(code: string, locked: boolean, userId: string): Promise<{ code: string; status: string }> {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.fiscalPeriod.findUnique({ where: { code } });
      if (!period) throw new NotFoundException({ code: 'NOT_FOUND', message: `Period not found: ${code}` });
      const updated = await tx.fiscalPeriod.update({
        where: { id: period.id },
        data: { status: locked ? 'LOCKED' : 'OPEN', lockedAt: locked ? new Date() : null },
      });
      await tx.auditLog.create({
        data: { userId, action: locked ? 'PERIOD_LOCKED' : 'PERIOD_UNLOCKED', entity: 'FiscalPeriod', entityId: period.id },
      });
      return { code: updated.code, status: updated.status };
    });
  }

  private async findPeriod(tx: import('@prisma/client').Prisma.TransactionClient, date: Date) {
    return tx.fiscalPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
    });
  }

  /** شماره سند الگویی JV-<سال‌میلادی>-<دنباله ۶رقمی> — داخل تراکنش (Race-safe با max) */
  private async nextEntryNo(tx: import('@prisma/client').Prisma.TransactionClient, date: Date): Promise<string> {
    const year = date.getUTCFullYear();
    // فاز ۸ — توالی مشترک با createDraft/closePeriod تا هر دو مسیر هرگز تداخل نکنند
    const seq = await nextDocSeq(tx, 'journal');
    return `JV-${year}-${String(seq).padStart(6, '0')}`;
  }

  /** جمع تراز یک سند — برای گزارش‌ها */
  static entryTotal(lines: Array<{ debitRials: bigint; creditRials: bigint }>): { debit: bigint; credit: bigint } {
    return {
      debit: addRials(...lines.map((l) => l.debitRials)),
      credit: addRials(...lines.map((l) => l.creditRials)),
    };
  }
}

/** شناسه سیستمی موتور سند خودکار */
export const SYSTEM_ENGINE_USER = 'system:engine';
export const newInboxKey = (): string => randomUUID();
