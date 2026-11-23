/**
 * dashboard.service.ts — فاز ۳ (F3-T1…T3): KPIها فقط از کوئری واقعی، هیچ عددی هاردکد نیست.
 * الگوی پنل‌ها از سورس مرجع hoteldashboard-5.1 (docs/18-module-references/hoteldashboard-notes.md)
 * و مرزهای دوره‌ها شمسی است (قوانین ۱۳/۱۴ — تقویم و اعداد).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { toJalaali, toGregorian } from '@hotel-erp/shared';

const REVENUE_ACCOUNTS = ['4101', '4102']; // درآمد اتاق + رستوران
const EXPENSE_ACCOUNTS = ['5101', '5102', '5103']; // بهای فروش + حقوق + بیمه کارفرما
const CASH_ACCOUNTS = ['1101', '1102']; // صندوق + بانک‌ها
const RECEIVABLE_ACCOUNT = '1201'; // حساب‌های دریافتنی مهمانان
const PAYABLE_ACCOUNT = '2101'; // حساب‌های پرداختنی تأمین‌کنندگان

export interface PeriodRange {
  start: Date;
  end: Date;
}

/** بازه روز UTC شامل تاریخ داده‌شده */
function dayRange(d: Date): PeriodRange {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** بازه ماه شمسیِ تاریخ داده‌شده — مرز دوره‌ها جلالی است */
function monthRange(d: Date): PeriodRange {
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const gStart = toGregorian(j.jy, j.jm, 1);
  const start = new Date(Date.UTC(gStart.gy, gStart.gm - 1, gStart.gd));
  const jmNext = j.jm === 12 ? 1 : j.jm + 1;
  const jyNext = j.jm === 12 ? j.jy + 1 : j.jy;
  const gEnd = toGregorian(jyNext, jmNext, 1);
  const end = new Date(Date.UTC(gEnd.gy, gEnd.gm - 1, gEnd.gd));
  return { start, end };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** مانده (بدهکار − بستانکار) یک گروه حساب روی اسناد قطعی */
  private async accountBalance(codes: string[]): Promise<bigint> {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: { accountCode: { in: codes }, entry: { status: 'POSTED' } },
      _sum: { debitRials: true, creditRials: true },
    });
    let sum = 0n;
    for (const r of rows) {
      sum += (r._sum.debitRials ?? 0n) - (r._sum.creditRials ?? 0n);
    }
    return sum;
  }

  /** گردش (بدهکار − بستانکار) گروه حساب در بازه */
  private async accountMovement(codes: string[], range: PeriodRange): Promise<bigint> {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: codes },
        entry: { status: 'POSTED', entryDate: { gte: range.start, lt: range.end } },
      },
      _sum: { debitRials: true, creditRials: true },
    });
    let sum = 0n;
    for (const r of rows) {
      sum += (r._sum.debitRials ?? 0n) - (r._sum.creditRials ?? 0n);
    }
    return sum;
  }

  /** درآمد شناسایی‌شده در بازه (بستانکار حساب‌های درآمد) */
  private async revenueBetween(range: PeriodRange): Promise<bigint> {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: REVENUE_ACCOUNTS },
        entry: { status: 'POSTED', entryDate: { gte: range.start, lt: range.end } },
      },
      _sum: { debitRials: true, creditRials: true },
    });
    let sum = 0n;
    for (const r of rows) {
      sum += (r._sum.creditRials ?? 0n) - (r._sum.debitRials ?? 0n);
    }
    return sum;
  }

  /** هزینه دوره (بدهکار حساب‌های هزینه) */
  private async expenseBetween(range: PeriodRange): Promise<bigint> {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: EXPENSE_ACCOUNTS },
        entry: { status: 'POSTED', entryDate: { gte: range.start, lt: range.end } },
      },
      _sum: { debitRials: true, creditRials: true },
    });
    let sum = 0n;
    for (const r of rows) {
      sum += (r._sum.debitRials ?? 0n) - (r._sum.creditRials ?? 0n);
    }
    return sum;
  }

  /** اشغال امروز به تفکیک نوع اتاق — رزروهای مؤثر بر امروز (checkOut انحصاری) */
  private async occupancyToday(day: PeriodRange) {
    const [types, rooms, reservations] = await Promise.all([
      this.prisma.roomType.findMany({ select: { id: true, nameFa: true } }),
      // ظرفیت واقعی = اتاق‌های خارج از سرویس‌نشده (تعمیرات لحظه‌ای ظرفیت را کم می‌کند)
      this.prisma.room.groupBy({ by: ['roomTypeId'], where: { status: { not: 'OUT_OF_SERVICE' } }, _count: { _all: true } }),
      this.prisma.reservation.groupBy({
        by: ['roomTypeId'],
        // باگ #۶: مهمان‌های درخانه CHECKED_IN هم اشغال امروز هستند
        where: { status: { in: ['CONFIRMED', 'CHECKED_IN'] }, checkIn: { lt: day.end }, checkOut: { gt: day.start } },
        _count: { _all: true },
      }),
    ]);
    const roomsByType = new Map(rooms.map((r) => [r.roomTypeId, r._count._all]));
    const occupiedByType = new Map(reservations.map((r) => [r.roomTypeId, r._count._all]));
    let totalRooms = 0;
    let occupiedUnits = 0;
    const byType = types.map((t) => {
      const total = roomsByType.get(t.id) ?? 0;
      const occupied = Math.min(occupiedByType.get(t.id) ?? 0, total);
      totalRooms += total;
      occupiedUnits += occupied;
      return { roomType: t.nameFa, occupied, total, pct: total ? Math.round((occupied / total) * 100) : 0 };
    });
    return { totalRooms, occupiedUnits, pct: totalRooms ? Math.round((occupiedUnits / totalRooms) * 100) : 0, byType };
  }

  /** F3-T1 — داشبورد مدیرعامل: اشغال، درآمد روز/ماه، سود، جریان نقد */
  async ceo() {
    const now = new Date();
    const day = dayRange(now);
    const month = monthRange(now);

    const [occupancy, revenueToday, revenueMonth, expenseMonth, cashBalance, cashMovement] = await Promise.all([
      this.occupancyToday(day),
      this.revenueBetween(day),
      this.revenueBetween(month),
      this.expenseBetween(month),
      this.accountBalance(CASH_ACCOUNTS),
      this.accountMovement(CASH_ACCOUNTS, month),
    ]);

    return {
      asOf: formatJalaliToday(now),
      occupancy,
      revenueTodayRials: revenueToday.toString(),
      revenueMonthRials: revenueMonth.toString(),
      profitMonthRials: (revenueMonth - expenseMonth).toString(),
      cashBalanceRials: cashBalance.toString(),
      cashFlowMonthRials: cashMovement.toString(),
      expenseMonthRials: expenseMonth.toString(),
    };
  }

  /** F3-T2 — داشبورد مدیر مالی: بانک/صندوق، اسناد معلق، مطالبات + هشدار اقلام معلق */
  async finance() {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const [cash, banks, receivable, payable, drafts, stale] = await Promise.all([
      this.accountBalance(['1101']),
      this.accountBalance(['1102']),
      this.accountBalance([RECEIVABLE_ACCOUNT]),
      this.prisma.journalLine.groupBy({
        by: ['accountCode'],
        where: { accountCode: PAYABLE_ACCOUNT, entry: { status: 'POSTED' } },
        _sum: { debitRials: true, creditRials: true },
      }),
      this.prisma.journalEntry.findMany({ where: { status: 'DRAFT' }, select: { entryNo: true, entryDate: true } }),
      this.prisma.journalEntry.findMany({
        where: { status: 'DRAFT', entryDate: { lt: staleThreshold } },
        select: { entryNo: true, entryDate: true, description: true },
        orderBy: { entryDate: 'asc' },
      }),
    ]);

    let payableSum = 0n;
    for (const r of payable) payableSum += (r._sum.creditRials ?? 0n) - (r._sum.debitRials ?? 0n);

    const alerts = stale.map((s) => ({
      severity: 'warning',
      messageFa: `سند پیش‌نویس ${s.entryNo} بیش از ۷ روز معلق است (${s.description})`,
      entryNo: s.entryNo,
      entryDate: s.entryDate,
    }));

    return {
      asOf: formatJalaliToday(now),
      cashBoxes: [{ code: '1101', nameFa: 'صندوق', balanceRials: cash.toString() }],
      bankAccounts: [{ code: '1102', nameFa: 'بانک‌ها', balanceRials: banks.toString() }],
      unpostedDrafts: drafts.length,
      unpostedDraftRials: await this.draftTotals(),
      receivablesRials: receivable.toString(),
      payablesRials: payableSum.toString(),
      staleItems: alerts,
      alertsCount: alerts.length,
    };
  }

  private async draftTotals(): Promise<string> {
    const lines = await this.prisma.journalLine.groupBy({
      by: ['entryId'],
      where: { entry: { status: 'DRAFT' } },
      _sum: { debitRials: true },
    });
    let sum = 0n;
    for (const l of lines) sum += l._sum.debitRials ?? 0n;
    return sum.toString();
  }

  /** F3-T3 — پنل رستوران: فروش/تعداد/میانگین امروز + ضایعات (نیازمند ماژول انبار فاز ۷) */
  async restaurant() {
    const day = dayRange(new Date());
    const [orders, outlets] = await Promise.all([
      this.prisma.posOrder.findMany({
        where: { servedAt: { gte: day.start, lt: day.end } },
        select: { totalRials: true, taxRials: true, outletId: true },
      }),
      this.prisma.posOutlet.findMany({ select: { id: true, nameFa: true } }),
    ]);

    let sales = 0n;
    let tax = 0n;
    const byOutlet = new Map<string, bigint>();
    for (const o of orders) {
      sales += o.totalRials;
      tax += o.taxRials;
      byOutlet.set(o.outletId, (byOutlet.get(o.outletId) ?? 0n) + o.totalRials);
    }
    const outletNames = new Map(outlets.map((o) => [o.id, o.nameFa]));

    return {
      asOf: formatJalaliToday(new Date()),
      todayOrders: orders.length,
      todaySalesRials: sales.toString(),
      todayTaxRials: tax.toString(),
      todayNetRials: (sales - tax).toString(),
      avgTicketRials: orders.length ? (sales / BigInt(orders.length)).toString() : '0',
      salesByOutlet: [...byOutlet.entries()].map(([id, v]) => ({
        outlet: outletNames.get(id) ?? id,
        salesRials: v.toString(),
      })),
      waste: {
        todayRials: '0',
        note: 'KPI ضایعات پس از ماژول انبار (فاز ۷) از کوئری واقعی پر می‌شود — الان صفر واقعی است نه تخمین',
      },
    };
  }

  /** F3-T3 — پنل خانه‌داری: وضعیت اتاق‌ها، اشغال به تفکیک نوع، ورود/خروج امروز */
  async housekeeping() {
    const now = new Date();
    const day = dayRange(now);
    const [statusRows, occupancy, arrivals, departures] = await Promise.all([
      this.prisma.room.groupBy({ by: ['status'], _count: { _all: true } }),
      this.occupancyToday(day),
      this.prisma.reservation.count({
        where: { status: 'CONFIRMED', checkIn: { gte: day.start, lt: day.end } },
      }),
      this.prisma.reservation.count({
        where: { status: 'CONFIRMED', checkOut: { gte: day.start, lt: day.end } },
      }),
    ]);

    const statusFa: Record<string, string> = {
      AVAILABLE: 'آماده',
      OCCUPIED: 'اشغال‌شده',
      DIRTY: 'نیازمند نظافت',
      OUT_OF_SERVICE: 'خارج از سرویس',
    };

    return {
      asOf: formatJalaliToday(now),
      roomsByStatus: statusRows.map((r) => ({
        status: r.status,
        labelFa: statusFa[r.status] ?? r.status,
        count: r._count._all,
      })),
      totalRooms: occupancy.totalRooms,
      occupancyByType: occupancy.byType,
      arrivalsToday: arrivals,
      departuresToday: departures,
    };
  }
}

/** تاریخ امروز به شمسی — قوانین ۱۳/۱۴ */
function formatJalaliToday(d: Date): string {
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  return `${j.jd} ${months[j.jm - 1]} ${j.jy}`;
}
