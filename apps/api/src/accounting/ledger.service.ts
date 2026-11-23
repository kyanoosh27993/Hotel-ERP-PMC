/**
 * ledger.service.ts — فاز ۸ / F8-T3: دفاتر روزنامه/کل/معین، تراز آزمایشی،
 * صورت سود و زیان، ترازنامه، بستن دوره با سند اختتام.
 * همهٔ جمع‌ها BigInt و در پاسخ Number؛ تراز آزمایشی باید صفر باشد (معیار پذیرش).
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { nextDocSeq } from '../common/doc-seq';

const N = (v: bigint | null | undefined) => Number(v ?? 0n);

// مانده‌ها همه‌جا «بدهکار-مثبت» نگه داشته می‌شوند (debit − credit) تا جمع ستون‌های
// تراز آزمایشی دقیقاً صفر شود — قاعدهٔ دوطرفه بودن ثبت.

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** دفتر روزنامه — اسناد قطعی در بازه به ترتیب شماره عطف */
  async journalBook(from: string, to: string) {
    const entries = await this.prisma.journalEntry.findMany({
      where: { postingDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) }, status: { in: ['POSTED', 'REVERSED'] } },
      orderBy: [{ docIndex: 'asc' }],
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      take: 1000,
    });
    return {
      data: entries.map((e) => ({
        docIndex: e.docIndex ? Number(e.docIndex) : null,
        entryNo: e.entryNo,
        entryDate: e.entryDate.toISOString().slice(0, 10),
        description: e.description,
        status: e.status,
        sourceModule: e.sourceModule,
        sourceRef: e.sourceRef,
        totalDebit: N(e.lines.reduce((a, l) => a + l.debitRials, 0n)),
        lines: e.lines.map((l) => ({
          lineNo: l.lineNo, accountCode: l.accountCode, costCenterCode: l.costCenterCode,
          debit: N(l.debitRials), credit: N(l.creditRials),
        })),
      })),
      meta: { count: entries.length, from, to },
    };
  }

  /** دفتر کل — گردش و ماندهٔ هر حساب در بازه با ماندهٔ ابتدای دوره */
  async generalLedger(from: string, to: string) {
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T23:59:59Z`);
    const accounts = await this.prisma.account.findMany({ orderBy: { code: 'asc' } });

    const agg = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: { entry: { postingDate: { gte: fromDate, lte: toDate }, status: 'POSTED' } },
      _sum: { debitRials: true, creditRials: true },
    });
    const opening = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: { entry: { postingDate: { lt: fromDate }, status: 'POSTED' } },
      _sum: { debitRials: true, creditRials: true },
    });
    const aggMap = new Map(agg.map((r) => [r.accountCode, r._sum]));
    const openMap = new Map(opening.map((r) => [r.accountCode, r._sum]));

    const rows = accounts.map((a) => {
      const d = aggMap.get(a.code); const o = openMap.get(a.code);
      const periodDebit = N(d?.debitRials); const periodCredit = N(d?.creditRials);
      const openDebit = N(o?.debitRials); const openCredit = N(o?.creditRials);
      const openingBalance = openDebit - openCredit;
      const closingBalance = openingBalance + periodDebit - periodCredit;
      return {
        accountCode: a.code, accountNameFa: a.nameFa, type: a.type,
        openingBalance, periodDebit, periodCredit, closingBalance,
      };
    }).filter((r) => r.openingBalance !== 0 || r.periodDebit !== 0 || r.periodCredit !== 0 || r.closingBalance !== 0);

    const totalDebit = rows.reduce((a, r) => a + r.periodDebit, 0);
    const totalCredit = rows.reduce((a, r) => a + r.periodCredit, 0);
    return { data: rows, meta: { from, to, totalDebit, totalCredit, balanced: totalDebit === totalCredit } };
  }

  /** دفتر معین — سطور یک حساب با ماندهٔ تجمعی */
  async subsidiaryLedger(accountCode: string, from: string, to: string) {
    const account = await this.prisma.account.findUnique({ where: { code: accountCode } });
    if (!account) throw new NotFoundException('حساب یافت نشد');
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T23:59:59Z`);

    const openingAgg = await this.prisma.journalLine.aggregate({
      where: { accountCode, entry: { postingDate: { lt: fromDate }, status: 'POSTED' } },
      _sum: { debitRials: true, creditRials: true },
    });
    let running = N(openingAgg._sum.debitRials) - N(openingAgg._sum.creditRials);
    const openingBalance = running;

    const lines = await this.prisma.journalLine.findMany({
      where: { accountCode, entry: { postingDate: { gte: fromDate, lte: toDate }, status: 'POSTED' } },
      orderBy: [{ entry: { postingDate: 'asc' } }, { entryId: 'asc' }, { lineNo: 'asc' }],
      include: { entry: { select: { entryNo: true, description: true, postingDate: true, sourceModule: true } } },
      take: 1000,
    });
    const rows = lines.map((l) => {
      running += N(l.debitRials) - N(l.creditRials);
      return {
        date: l.entry.postingDate.toISOString().slice(0, 10),
        entryNo: l.entry.entryNo,
        description: l.entry.description,
        sourceModule: l.entry.sourceModule,
        costCenterCode: l.costCenterCode,
        debit: N(l.debitRials), credit: N(l.creditRials),
        runningBalance: running,
      };
    });
    return {
      data: rows,
      meta: {
        accountCode, accountNameFa: account.nameFa, from, to,
        openingBalance, closingBalance: running, lineCount: rows.length,
      },
    };
  }

  /** تراز آزمایشی — ماندهٔ ابتدا، گردش، ماندهٔ پایان برای همهٔ حساب‌ها */
  async trialBalance(from: string, to: string) {
    const gl = await this.generalLedger(from, to);
    const rows = gl.data.map((r) => {
      // نمایش دوطرفه: مانده بدهکار/بستانکار جدا
      const closingDebit = r.closingBalance > 0 ? r.closingBalance : 0;
      const closingCredit = r.closingBalance < 0 ? -r.closingBalance : 0;
      const openingDebit = r.openingBalance > 0 ? r.openingBalance : 0;
      const openingCredit = r.openingBalance < 0 ? -r.openingBalance : 0;
      return { ...r, openingDebit, openingCredit, closingDebit, closingCredit };
    });
    const totals = {
      openingDebit: rows.reduce((a, r) => a + r.openingDebit, 0),
      openingCredit: rows.reduce((a, r) => a + r.openingCredit, 0),
      periodDebit: rows.reduce((a, r) => a + r.periodDebit, 0),
      periodCredit: rows.reduce((a, r) => a + r.periodCredit, 0),
      closingDebit: rows.reduce((a, r) => a + r.closingDebit, 0),
      closingCredit: rows.reduce((a, r) => a + r.closingCredit, 0),
    };
    return {
      data: rows, meta: {
        from, to, totals,
        balanced: totals.openingDebit === totals.openingCredit
          && totals.periodDebit === totals.periodCredit
          && totals.closingDebit === totals.closingCredit,
      },
    };
  }

  /** صورت سود و زیان — درآمدها، بهای تمام‌شده، هزینه‌ها و نتیجهٔ دوره */
  async incomeStatement(from: string, to: string) {
    const gl = await this.generalLedger(from, to);
    const revenue = gl.data.filter((r) => r.type === 'REVENUE');
    const expense = gl.data.filter((r) => r.type === 'EXPENSE');
    const totalRevenue = -revenue.reduce((a, r) => a + r.closingBalance, 0); // بستانکار-طبیعی
    const totalExpense = expense.reduce((a, r) => a + r.closingBalance, 0);
    return {
      meta: { from, to },
      revenue: revenue.map((r) => ({ accountCode: r.accountCode, nameFa: r.accountNameFa, amount: -r.closingBalance })),
      expense: expense.map((r) => ({ accountCode: r.accountCode, nameFa: r.accountNameFa, amount: r.closingBalance })),
      totals: { totalRevenue, totalExpense, netIncome: totalRevenue - totalExpense },
    };
  }

  /** ترازنامه — ماندهٔ دارایی/بدهی/سرمایه در تاریخ + نتیجهٔ دوره (برای تراز بودن) */
  async balanceSheet(asOf: string) {
    const period = await this.prisma.fiscalPeriod.findFirst({
      where: { startDate: { lte: new Date(`${asOf}T23:59:59Z`) }, endDate: { gte: new Date(`${asOf}T00:00:00Z`) } },
    });
    // نتیجهٔ دوره: از ابتدای سال مالی تا asOf
    const yearStart = period ? period.startDate.toISOString().slice(0, 10) : `${asOf.slice(0, 4)}-01-01`;
    const pnl = await this.incomeStatement(yearStart, asOf);
    const gl = await this.generalLedger(yearStart, asOf);
    const by = (t: string) => gl.data.filter((r) => r.type === t);
    const assets = by('ASSET').map((r) => ({ accountCode: r.accountCode, nameFa: r.accountNameFa, amount: r.closingBalance })).filter((x) => x.amount !== 0);
    const liabilities = by('LIABILITY').map((r) => ({ accountCode: r.accountCode, nameFa: r.accountNameFa, amount: -r.closingBalance })).filter((x) => x.amount !== 0);
    const equity = by('EQUITY').map((r) => ({ accountCode: r.accountCode, nameFa: r.accountNameFa, amount: -r.closingBalance })).filter((x) => x.amount !== 0);
    const totalAssets = assets.reduce((a, x) => a + x.amount, 0);
    const totalLiabilities = liabilities.reduce((a, x) => a + x.amount, 0);
    const totalEquity = equity.reduce((a, x) => a + x.amount, 0);
    const netIncome = pnl.totals.netIncome;
    return {
      meta: { asOf, fiscalYearStart: yearStart },
      assets, liabilities, equity,
      currentPeriodIncome: { label: 'سود (زیان) دورهٔ جاری', amount: netIncome },
      totals: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        equityIncludingIncome: totalEquity + netIncome,
        balanced: totalAssets === totalLiabilities + totalEquity + netIncome,
      },
    };
  }

  /**
   * بستن دوره (فاز ۸) — پیش‌شرط‌ها: هیچ پیش‌نویس در دوره، اسناد متوازن.
   * سند اختتام: درآمدها/هزینه‌ها به سود انباشته (۳۹۰۱) منتقل و دوره قفل می‌شود.
   */
  async closePeriod(code: string, userId: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { code } });
    if (!period) throw new NotFoundException('دورهٔ مالی یافت نشد');
    if (period.closedAt) throw new ConflictException({ code: 'CONFLICT', message: `دورهٔ ${code} قبلاً بسته شده است` });

    const drafts = await this.prisma.journalEntry.count({
      where: { periodId: period.id, status: 'DRAFT' },
    });
    if (drafts > 0) throw new BadRequestException({ code: 'BUSINESS_RULE', message: `${drafts} سند پیش‌نویس در این دوره باز است — ابتدا تأیید یا حذف کنید` });

    // گردش درآمد/هزینهٔ دوره
    const pnlLines = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: { entry: { postingDate: { gte: period.startDate, lte: period.endDate }, status: 'POSTED' } },
      _sum: { debitRials: true, creditRials: true },
    });
    const accounts = await this.prisma.account.findMany();
    const typeOf = new Map(accounts.map((a) => [a.code, a.type]));
    const revenueRows = pnlLines.filter((l) => typeOf.get(l.accountCode) === 'REVENUE');
    const expenseRows = pnlLines.filter((l) => typeOf.get(l.accountCode) === 'EXPENSE');

    const netRevenue = revenueRows.reduce((a, l) => a + l._sum.creditRials! - l._sum.debitRials!, 0n);
    const netExpense = expenseRows.reduce((a, l) => a + l._sum.debitRials! - l._sum.creditRials!, 0n);
    const netIncome = netRevenue - netExpense;

    const lines: Array<{ accountCode: string; debitRials: bigint; creditRials: bigint; costCenterCode?: string }> = [];
    for (const l of revenueRows) {
      const bal = l._sum.creditRials! - l._sum.debitRials!; // مانده بستانکار
      if (bal > 0n) lines.push({ accountCode: l.accountCode, debitRials: bal, creditRials: 0n });
    }
    for (const l of expenseRows) {
      const bal = l._sum.debitRials! - l._sum.creditRials!; // مانده بدهکار
      if (bal > 0n) lines.push({ accountCode: l.accountCode, debitRials: 0n, creditRials: bal });
    }
    if (netIncome > 0n) lines.push({ accountCode: '3901', debitRials: 0n, creditRials: netIncome });
    if (netIncome < 0n) lines.push({ accountCode: '3901', debitRials: -netIncome, creditRials: 0n });
    if (lines.length === 0) throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'گردش درآمد/هزینه‌ای برای بستن دوره وجود ندارد' });

    const result = await this.prisma.$transaction(async (tx) => {
      const entryDate = period.endDate;
      const seq = await nextDocSeq(tx, 'journal');
      const docIndex = await nextDocSeq(tx, 'journal_docindex');
      const entryNo = `JV-${entryDate.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
      const entry = await tx.journalEntry.create({
        data: {
          entryNo, docIndex, entryDate, postingDate: entryDate,
          periodId: period.id,
          description: `سند اختتام دورهٔ ${code} — انتقال نتیجه به سود انباشته`,
          status: 'POSTED',
          sourceModule: 'accounting',
          sourceRef: `period-close:${code}`,
          approvedById: userId,
          approvedAt: new Date(),
          lines: { create: lines.map((l, i) => ({ lineNo: i + 1, accountCode: l.accountCode, debitRials: l.debitRials, creditRials: l.creditRials })) },
        },
        include: { lines: true },
      });
      await tx.auditLog.create({
        data: { userId, action: 'PERIOD_CLOSED', entity: 'FiscalPeriod', entityId: period.id },
      });
      return tx.fiscalPeriod.update({
        where: { id: period.id },
        data: { status: 'LOCKED', lockedAt: new Date(), closedAt: new Date(), closingEntryId: entry.id },
      });
    });

    return {
      data: {
        periodCode: code,
        closedAt: result.closedAt,
        closingEntryId: result.closingEntryId,
        netIncome: Number(netIncome),
        linesCount: lines.length,
        message: `دورهٔ ${code} بسته شد و نتیجهٔ ${netIncome > 0n ? 'سود' : 'زیان'} ${Number(netIncome < 0n ? -netIncome : netIncome).toLocaleString('fa-IR')} ریال به سود انباشته منتقل گردید`,
      },
    };
  }
}
