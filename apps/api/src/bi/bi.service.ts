/**
 * bi.service.ts — موج ۴ / فاز ۱۱: BI کامل و هوش مصنوعی گسترده.
 * F11-T1 تحلیل بخش‌ها + بودجه/واریانس | F11-T2 دستیار مدیر با منبع داده | F11-T3 پیش‌بینی جریان نقد ۱۳ هفته
 * F11-T4 سندزنی هوشمند (فقط پیش‌نویس — تأیید انسانی) | F11-T5 پیش‌بینی تقاضا/نرخ | F11-T6 ناهنجاری + احساسات
 * قاعدهٔ سند کارفرما: AI هرگز سند قطعی/پرداخت نمی‌زند — خروجی همهٔ موتورها پیش‌نویسِ نیازمند تأیید است.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { nextDocSeq } from '../common/doc-seq';

const REVENUE_ACCOUNTS = ['4101', '4102', '4103'];
const COST_ACCOUNTS = ['5101', '5102', '5103', '5104', '5201'];
const PAYABLE_ACCOUNTS = ['2101', '2201', '2202', '2203'];
const COST_CENTERS: Array<{ code: string; fa: string }> = [
  { code: 'CC-ROOMS', fa: 'اتاق‌ها' },
  { code: 'CC-FB', fa: 'رستوران و غذای و نوشیدنی' },
  { code: 'CC-ADMIN', fa: 'اداری' },
  { code: 'CC-OTHER', fa: 'سایر' },
];

const NEGATIVE_WORDS = ['لغو', 'انصراف', 'کسری', 'نقص', 'خراب', 'تأخیر', 'مشکل', 'برگشت', 'مغایرت', 'تخفیف', 'اتلاف', 'ضایعات', 'کمبود', 'شکایت'];
const POSITIVE_WORDS = ['تأیید', 'تسویه', 'تکمیل', 'رسید', 'پذیرش', 'ثبت موفق', 'ACCEPTED', 'بازگشایی', 'وصول'];

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function roundTo(n: bigint, step: bigint): bigint {
  if (step <= 0n) return n;
  const r = ((n % step) + step) % step;
  return r >= step / 2n ? n + step - r : n - r;
}

@Injectable()
export class BiService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── F11-T1 — تحلیل عملکرد بخش‌ها + بودجه/واریانس ─────────────────────────
  async departments(from: string, to: string, periodCode?: string) {
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T23:59:59.999Z');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('بازهٔ تاریخ نامعتبر است');

    const lines = await this.prisma.journalLine.findMany({
      where: {
        entry: { status: 'POSTED', postingDate: { gte: start, lte: end } },
        OR: [
          { accountCode: { in: REVENUE_ACCOUNTS } },
          { accountCode: { in: COST_ACCOUNTS } },
        ],
      },
      select: { accountCode: true, debitRials: true, creditRials: true, costCenterCode: true },
    });

    const agg = new Map<string, { revenue: bigint; cost: bigint }>();
    for (const cc of COST_CENTERS) agg.set(cc.code, { revenue: 0n, cost: 0n });
    agg.set('CC-NONE', { revenue: 0n, cost: 0n });
    for (const l of lines) {
      const key = l.costCenterCode ?? 'CC-NONE';
      if (!agg.has(key)) agg.set(key, { revenue: 0n, cost: 0n });
      const a = agg.get(key)!;
      if (REVENUE_ACCOUNTS.includes(l.accountCode)) a.revenue += l.creditRials - l.debitRials;
      else a.cost += l.debitRials - l.creditRials;
    }

    const budgets = periodCode
      ? await this.prisma.biBudget.findMany({ where: { periodCode } })
      : [];
    const budgetByCc = new Map(budgets.map((b) => [b.costCenterCode, b]));

    const rows = [...agg.entries()].map(([code, a]) => {
      const label = COST_CENTERS.find((c) => c.code === code)?.fa ?? (code === 'CC-NONE' ? 'بدون مرکز هزینه' : code);
      const b = budgetByCc.get(code);
      const revenue = a.revenue > 0n ? a.revenue : 0n;
      const cost = a.cost > 0n ? a.cost : 0n;
      const profit = revenue - cost;
      return {
        costCenterCode: code,
        labelFa: label,
        revenueRials: revenue.toString(),
        costRials: cost.toString(),
        profitRials: profit.toString(),
        budgetRevenueRials: b ? b.revenueRials.toString() : null,
        budgetCostRials: b ? b.costRials.toString() : null,
        varianceRevenueRials: b ? (revenue - b.revenueRials).toString() : null,
        varianceCostRials: b ? (cost - b.costRials).toString() : null,
        hasBudget: !!b,
      };
    }).filter((r) => r.costCenterCode !== 'CC-NONE' || r.revenueRials !== '0' || r.costRials !== '0');

    const totalRevenue = rows.reduce((a, r) => a + BigInt(r.revenueRials), 0n);
    const totalCost = rows.reduce((a, r) => a + BigInt(r.costRials), 0n);
    return {
      data: {
        from, to, periodCode: periodCode ?? null,
        rows,
        totals: { revenueRials: totalRevenue.toString(), costRials: totalCost.toString(), profitRials: (totalRevenue - totalCost).toString() },
      },
      meta: { rule: 'درآمد/هزینهٔ خالص هر مرکز هزینه از اسناد قطعی — واریانس نسبت به بودجهٔ ثبت‌شده در bi_budgets' },
    };
  }

  async upsertBudget(input: { taxYear: number; periodCode: string; costCenterCode: string; revenueRials: string; costRials: string; note?: string; userId?: string }) {
    const revenue = BigInt(input.revenueRials);
    const cost = BigInt(input.costRials);
    if (revenue < 0n || cost < 0n) throw new BadRequestException('بودجه نمی‌تواند منفی باشد');
    const saved = await this.prisma.biBudget.upsert({
      where: { taxYear_periodCode_costCenterCode: { taxYear: input.taxYear, periodCode: input.periodCode, costCenterCode: input.costCenterCode } },
      create: { taxYear: input.taxYear, periodCode: input.periodCode, costCenterCode: input.costCenterCode, revenueRials: revenue, costRials: cost, note: input.note ?? null },
      update: { revenueRials: revenue, costRials: cost, note: input.note ?? null },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'BI_BUDGET_UPSERT', entity: 'BiBudget', entityId: saved.id, reason: `${input.periodCode}/${input.costCenterCode}` },
    });
    return { data: { id: saved.id, taxYear: saved.taxYear, periodCode: saved.periodCode, costCenterCode: saved.costCenterCode, revenueRials: saved.revenueRials.toString(), costRials: saved.costRials.toString() } };
  }

  async listBudgets(periodCode: string) {
    const rows = await this.prisma.biBudget.findMany({ where: { periodCode }, orderBy: { costCenterCode: 'asc' } });
    return { data: rows.map((b) => ({ id: b.id, taxYear: b.taxYear, periodCode: b.periodCode, costCenterCode: b.costCenterCode, revenueRials: b.revenueRials.toString(), costRials: b.costRials.toString(), note: b.note })) };
  }

  // ───────────────────────── F11-T2 — دستیار مدیر (پرسش‌وپاسخ با منبع داده) ─────────────────────────
  private async occupiedUnits(): Promise<{ occupied: number; total: number }> {
    const total = await this.prisma.room.count({ where: { status: { not: 'OUT_OF_SERVICE' } } });
    const open = await this.prisma.stayRoom.count({ where: { stay: { status: 'OPEN' }, room: { status: { not: 'OUT_OF_SERVICE' } } } });
    return { occupied: open, total };
  }

  private async revenueNet(from: Date, to: Date): Promise<bigint> {
    const lines = await this.prisma.journalLine.findMany({
      where: { entry: { status: 'POSTED', postingDate: { gte: from, lte: to } }, accountCode: { in: REVENUE_ACCOUNTS } },
      select: { debitRials: true, creditRials: true },
    });
    let net = 0n;
    for (const l of lines) net += l.creditRials - l.debitRials;
    return net > 0n ? net : 0n;
  }

  private async accountBalance(codes: string[]): Promise<bigint> {
    const lines = await this.prisma.journalLine.findMany({
      where: { accountCode: { in: codes }, entry: { status: 'POSTED' } },
      select: { debitRials: true, creditRials: true },
    });
    let bal = 0n;
    for (const l of lines) bal += l.debitRials - l.creditRials;
    return bal;
  }

  private async balanceCredit(codes: string[]): Promise<bigint> {
    const lines = await this.prisma.journalLine.findMany({
      where: { accountCode: { in: codes }, entry: { status: 'POSTED' } },
      select: { debitRials: true, creditRials: true },
    });
    let bal = 0n;
    for (const l of lines) bal += l.creditRials - l.debitRials;
    return bal;
  }

  /**
   * پاسخ دستیار — هر عدد از یک کوئری واقعی با برچسب منبع می‌آید؛ هیچ عددی از خود مدل تولید نمی‌شود
   * (معیار پذیرش F11-T2: پاسخ با منبع داده، بدون عدد حدسی).
   */
  async assistant(question: string, userId?: string) {
    const q = (question ?? '').replace(/\u200c/g, ' ').trim();
    if (!q) throw new BadRequestException('پرسش خالی است');
    const now = new Date();
    const todayStart = dayStart(now);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sources: Array<{ label: string; value: string; query: string }> = [];
    let answer = '';

    const has = (...ws: string[]) => ws.some((w) => q.includes(w));

    if (has('اشغال', 'اتاق اشغال', 'درصد اشغال')) {
      const o = await this.occupiedUnits();
      const pct = o.total ? Math.round((o.occupied / o.total) * 100) : 0;
      sources.push({ label: 'اقامت‌های باز / اتاق‌های فعال', value: `${o.occupied} از ${o.total}`, query: 'stay_rooms(stay.OPEN) vs rooms(active)' });
      answer = `اشغال امروز ${o.occupied} اتاق از ${o.total} است (${pct}٪) — منبع: اقامت‌های باز در برابر ظرفیت فعال.`;
    } else if (has('درآمد امروز')) {
      const rev = await this.revenueNet(todayStart, now);
      sources.push({ label: 'درآمد خالص امروز (۴۱۰۱..۴۱۰۳)', value: rev.toString(), query: 'journal_lines net, POSTED, today' });
      answer = `درآمد خالص امروز ${rev.toLocaleString('fa-IR')} ریال است — منبع: اسناد قطعی حسابداری امروز.`;
    } else if (has('درآمد ماه')) {
      const rev = await this.revenueNet(monthStart, now);
      sources.push({ label: 'درآمد خالص ماه جاری', value: rev.toString(), query: 'journal_lines net, POSTED, month-to-date' });
      answer = `درآمد خالص ماه جاری ${rev.toLocaleString('fa-IR')} ریال است — منبع: اسناد قطعی از ابتدای ماه.`;
    } else if (has('صندوق', 'نقد', 'وجوه', 'بانک')) {
      const cash = await this.accountBalance(['1101']);
      const bank = await this.accountBalance(['1102']);
      sources.push({ label: 'ماندهٔ صندوق (۱۱۰۱)', value: cash.toString(), query: 'journal_lines 1101 debit-credit' });
      sources.push({ label: 'ماندهٔ بانک‌ها (۱۱۱۰۲)', value: bank.toString(), query: 'journal_lines 1102 debit-credit' });
      answer = `ماندهٔ صندوق ${cash.toLocaleString('fa-IR')} ریال و بانک‌ها ${bank.toLocaleString('fa-IR')} ریال است — منبع: ماندهٔ حساب‌های ۱۱۰۱/۱۱۱۰۲ از اسناد قطعی.`;
    } else if (has('مطالبات', 'حساب مهمان')) {
      const rec = await this.accountBalance(['1201']);
      sources.push({ label: 'ماندهٔ مطالبات (۱۲۰۱)', value: rec.toString(), query: 'journal_lines 1201 debit-credit' });
      answer = `مطالبات جاری ${rec.toLocaleString('fa-IR')} ریال است — منبع: ماندهٔ بدهکار حساب مهمان (۱۲۰۱).`;
    } else if (has('بدهی', 'پرداختنی', 'بستانکار')) {
      const pay = await this.balanceCredit(PAYABLE_ACCOUNTS);
      sources.push({ label: 'جمع بدهی‌های جاری', value: pay.toString(), query: 'journal_lines 2101+2201+2202+2203 credit-debit' });
      answer = `جمع بدهی‌های جاری ${pay.toLocaleString('fa-IR')} ریال است — منبع: حساب‌های ۲۱۰۱/۲۲۰۱/۲۲۰۲/۲۲۰۳.`;
    } else if (has('حقوق', 'دستمزد')) {
      const run = await this.prisma.payrollRun.findFirst({ orderBy: { createdAt: 'desc' } });
      sources.push({ label: 'آخرین دورهٔ حقوق', value: run ? `${run.periodCode} — خالص ${run.netRials.toString()}` : 'بدون دوره', query: 'payroll_runs latest' });
      answer = run
        ? `آخرین دورهٔ حقوق ${run.periodCode} با خالص پرداختی ${run.netRials.toLocaleString('fa-IR')} ریال برای ${run.employeeCount} نفر محاسبه شده — منبع: payroll_runs.`
        : 'هنوز دورهٔ حقوقی محاسبه نشده است — منبع: payroll_runs.';
    } else if (has('ارزش افزوده', 'مالیات بر ارزش')) {
      const out = await this.balanceCredit(['2201']);
      const inp = await this.accountBalance(['2204']);
      sources.push({ label: 'مالیات فروش (۲۲۰۱)', value: out.toString(), query: 'journal_lines 2201 credit-debit' });
      sources.push({ label: 'اعتبار خرید (۲۲۰۴)', value: inp.toString(), query: 'journal_lines 2204 debit-credit' });
      answer = `مالیات فروش بستانکار ${out.toLocaleString('fa-IR')} و اعتبار خرید ${inp.toLocaleString('fa-IR')} ریال است — منبع: حساب‌های ۲۲۰۱/۲۲۰۴.`;
    } else if (has('مالیات عملکرد', 'ماده ۱۰۵', 'اظهارنامه')) {
      const ret = await this.prisma.directTaxReturn.findFirst({ orderBy: { taxYear: 'desc' } });
      sources.push({ label: 'آخرین اظهارنامهٔ عملکرد', value: ret ? `سال ${ret.taxYear} — متعلق ${ret.taxDueRials.toString()}` : 'بدون اظهارنامه', query: 'direct_tax_returns latest' });
      answer = ret
        ? `اظهارنامهٔ عملکرد سال ${ret.taxYear} با مالیات متعلق ${ret.taxDueRials.toLocaleString('fa-IR')} ریال در وضعیت ${ret.status === 'SUBMITTED' ? 'ارسال‌شده' : 'پیش‌نویس'} است — منبع: direct_tax_returns.`
        : 'اظهارنامه‌ای محاسبه نشده است — منبع: direct_tax_returns.';
    } else if (has('وضعیت اتاق', 'اتاق‌ها', 'نظیف', 'کثیف')) {
      const rows = await this.prisma.room.groupBy({ by: ['status'], _count: { _all: true } });
      const fa: Record<string, string> = { OCCUPIED: 'اشغال', VACANT_CLEAN: 'آزاد/نظیف', VACANT_DIRTY: 'آزاد/کثیف', CLEANING: 'در حال نظافت', OUT_OF_SERVICE: 'خارج از سرویس' };
      const parts = rows.map((r) => `${fa[r.status] ?? r.status}: ${r._count._all}`);
      sources.push({ label: 'وضعیت اتاق‌ها', value: rows.map((r) => `${r.status}=${r._count._all}`).join(' '), query: 'rooms group by status' });
      answer = `وضعیت اتاق‌ها: ${parts.join('، ')} — منبع: جدول اتاق‌ها.`;
    } else if (has('سفارش', 'رستوران باز', 'پوز')) {
      const openOrders = await this.prisma.restaurantOrder.count({ where: { status: 'OPEN' } });
      const servedToday = await this.prisma.restaurantOrder.count({ where: { status: 'SERVED', servedAt: { gte: todayStart } } });
      sources.push({ label: 'سفارش‌های باز', value: String(openOrders), query: 'restaurant_orders status=OPEN' });
      sources.push({ label: 'سرو امروز', value: String(servedToday), query: 'restaurant_orders SERVED today' });
      answer = `${openOrders} سفارش باز و ${servedToday} سفارش سرو‌شدهٔ امروز داریم — منبع: جدول سفارش‌های رستوران.`;
    } else if (has('آشپزخانه', 'بلیت', 'kds')) {
      const pending = await this.prisma.kitchenTicket.count({ where: { status: { in: ['QUEUED', 'PREPARING'] } } });
      sources.push({ label: 'بلیت‌های در جریان آشپزخانه', value: String(pending), query: 'kitchen_tickets QUEUED/PREPARING' });
      answer = `${pending} بلیت در جریان آشپزخانه است — منبع: kitchen_tickets.`;
    } else if (has('جریان نقد', 'پیش‌بینی نقد')) {
      const cf = await this.cashflowForecast();
      const deficitWeeks = cf.data.weeks.filter((w) => w.deficit).length;
      sources.push({ label: 'ماندهٔ آغازین (۱۱۰۱+۱۱۱۰۲)', value: cf.data.startBalanceRials, query: 'journal_lines cash+bank' });
      sources.push({ label: 'هفته‌های کسری در ۱۳ هفته', value: String(deficitWeeks), query: 'bi cashflow forecast' });
      answer = deficitWeeks === 0
        ? `پیش‌بینی ۱۳ هفتهٔ جریان نقد کسری نشان نمی‌دهد؛ ماندهٔ آغازین ${Number(cf.data.startBalanceRials).toLocaleString('fa-IR')} ریال است — جزئیات: GET /bi/cashflow-forecast.`
        : `پیش‌بینی ۱۳ هفته، ${deficitWeeks} هفتهٔ کسری نشان می‌دهد؛ ماندهٔ آغازین ${Number(cf.data.startBalanceRials).toLocaleString('fa-IR')} ریال — جزئیات: GET /bi/cashflow-forecast.`;
    } else {
      answer = 'پرسش را از این‌ها انتخاب کنید: اشغال، درآمد امروز، درآمد ماه، صندوق، مطالبات، بدهی‌ها، حقوق، ارزش افزوده، مالیات عملکرد، وضعیت اتاق‌ها، سفارش‌های رستوران، بلیت آشپزخانه، جریان نقد. هر پاسخ با منبع دادهٔ واقعی همراه است.';
    }

    await this.prisma.auditLog.create({
      data: { userId, action: 'AI_ASSISTANT', entity: 'BiService', entityId: null, reason: q.slice(0, 180) },
    });
    return { data: { question: q, answer, sources } };
  }

  // ───────────────────────── F11-T3 — پیش‌بینی جریان وجوه ۱۳ هفته + هشدار کسری ─────────────────────────
  async cashflowForecast(weeks = 13) {
    if (weeks < 1 || weeks > 26) throw new BadRequestException('تعداد هفته باید بین ۱ و ۲۶ باشد');
    const cash = await this.accountBalance(['1101']);
    const bank = await this.accountBalance(['1102']);
    const receivable = await this.accountBalance(['1201']);
    const payable = await this.balanceCredit(PAYABLE_ACCOUNTS);

    // میانگین هزینهٔ ثابت ماهانه از اسناد قطعی سه ماه اخیر (نرخ هفته = ماهانه ÷ ۴.۳۳)
    const costFrom = addDays(dayStart(new Date()), -90);
    const costLines = await this.prisma.journalLine.findMany({
      where: { entry: { status: 'POSTED', postingDate: { gte: costFrom } }, accountCode: { in: COST_ACCOUNTS } },
      select: { debitRials: true, creditRials: true },
    });
    let costSum = 0n;
    for (const l of costLines) costSum += l.debitRials - l.creditRials;
    const monthlyCost = costSum / 3n;
    const weeklyFixed = monthlyCost / BigInt(4);

    // حقوق: از آخرین دورهٔ محاسبه‌شده (ماهانه) — چهار واريز در ماه
    const run = await this.prisma.payrollRun.findFirst({ orderBy: { createdAt: 'desc' } });
    const weeklyPayroll = run ? run.netRials / BigInt(4) : 0n;

    // منحنی وصول مطالبات: ۵۰٪ هفتهٔ اول، ۳۰٪ دوم، ۱۰٪ سوم، ۱۰٪ چهارم
    const curve = [5n, 3n, 1n, 1n]; // از ۱۰
    // بدهی‌ها: پرداخت در چهار هفتهٔ اول به‌طور یکنواخت
    const weeklyDebt = payable / BigInt(4);

    const rows: Array<{ weekNo: number; from: string; to: string; inflowRials: string; outflowRials: string; endBalanceRials: string; deficit: boolean }> = [];
    const warnings: string[] = [];
    let balance = cash + bank;
    const reserve = monthlyCost / 3n; // ذخیرهٔ احتیاطی = یک‌سوم هزینهٔ ماهانه
    const start = addDays(dayStart(new Date()), 1);
    for (let w = 1; w <= weeks; w++) {
      const from = addDays(start, (w - 1) * 7);
      const to = addDays(from, 6);
      const inflow = w <= 4 ? (receivable * curve[w - 1]) / 10n : 0n;
      const outflow = weeklyFixed + weeklyPayroll + (w <= 4 ? weeklyDebt : 0n);
      balance = balance + inflow - outflow;
      const deficit = balance < 0n;
      if (deficit) warnings.push(`هفتهٔ ${w} (تا ${to.toISOString().slice(0, 10)}) مانده منفی می‌شود`);
      else if (balance < reserve) warnings.push(`هفتهٔ ${w}: مانده زیر ذخیرهٔ احتیاطی می‌رسد`);
      rows.push({
        weekNo: w, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
        inflowRials: inflow.toString(), outflowRials: outflow.toString(),
        endBalanceRials: balance.toString(), deficit,
      });
    }
    return {
      data: {
        startBalanceRials: (cash + bank).toString(),
        receivablesRials: receivable.toString(),
        payablesRials: payable.toString(),
        weeklyFixedCostRials: weeklyFixed.toString(),
        weeklyPayrollRials: weeklyPayroll.toString(),
        reserveRials: reserve.toString(),
        weeks: rows,
        warnings,
      },
      meta: { rule: 'قاعده‌محور: منحنی وصول مطالبات (۵۰/۳۰/۱۰/۱۰٪)، هزینهٔ ثابت میانگین ۹۰ روز، حقوق از آخرین دوره، بدهی‌ها در ۴ هفته — پیش‌بینی است نه تعهد' },
    };
  }

  // ───────────────────────── F11-T4 — سندزنی هوشمند (فقط پیش‌نویس) ─────────────────────────
  async createDocDraft(text: string, userId?: string) {
    if (!text || text.trim().length < 10) throw new BadRequestException('متن سند کوتاه است — حداقل یک فاکتور واقعی بچسبانید');
    const t = text.replace(/\u200c/g, ' ');
    const num = (s: string) => Number(s.replace(/[٬,]/g, ''));
    // استخراج قاعده‌محور — بدون OCR خارجی؛ متن/CSV
    const amountM = t.match(/مبلغ[^0-9]{0,8}([\d٬,]{3,})/) ?? t.match(/([\d٬,]{7,})\s*ریال/);
    const taxM = t.match(/مالیات[^0-9]{0,8}([\d٬,]{3,})/);
    const invM = t.match(/فاکتور[^0-9A-Za-z\u0600-\u06FF]{0,4}([\w\u0600-\u06FF-]{3,})/);
    const dateM = t.match(/(\d{4}-\d{2}-\d{2})/);
    const amount = amountM ? num(amountM[1]) : 0;
    const tax = taxM ? num(taxM[1]) : 0;

    // تطبیق تأمین‌کنندهٔ واقعی
    const suppliers = await this.prisma.supplier.findMany({ where: { active: true } });
    let supplier: { code: string; nameFa: string } | null = null;
    for (const s of suppliers) {
      if (s.nameFa && t.includes(s.nameFa)) { supplier = { code: s.code, nameFa: s.nameFa }; break; }
    }
    const net = amount > 0 && tax > 0 && tax < amount ? amount - tax : amount;
    const total = amount > 0 && tax > 0 && tax < amount ? amount : net + tax;

    const suggested: Array<{ accountCode: string; debit: string; credit: string; note: string }> = [];
    if (net > 0) suggested.push({ accountCode: '1301', debit: String(net), credit: '0', note: 'موجودی مواد و کالا — رسید خرید' });
    if (tax > 0) suggested.push({ accountCode: '2204', debit: String(tax), credit: '0', note: 'اعتبار مالیات بر ارزش افزودهٔ خرید' });
    if (total > 0) suggested.push({ accountCode: '2101', debit: '0', credit: String(total), note: supplier ? `بستانکار تأمین‌کنندهٔ ${supplier.nameFa}` : 'بستانکار تأمین‌کنندگان' });

    const draft = await this.prisma.aiDocDraft.create({
      data: {
        sourceText: text.slice(0, 4000),
        extractedJson: {
          amountRials: amount, taxRials: tax, netRials: net, totalRials: total,
          supplierCode: supplier?.code ?? null, supplierNameFa: supplier?.nameFa ?? null,
          invoiceNo: invM?.[1] ?? null, date: dateM?.[1] ?? null,
        } as never,
        suggestedLinesJson: suggested as never,
        createdById: userId,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'AI_DOC_DRAFT_CREATED', entity: 'AiDocDraft', entityId: draft.id, reason: supplier?.nameFa ?? null },
    });
    return {
      data: {
        id: draft.id, status: draft.status,
        extracted: draft.extractedJson,
        suggestedLines: draft.suggestedLinesJson,
        warning: 'هیچ سندی ثبت نشده است — پس از بازبینی، «تولید پیش‌نویس سند» را بزنید؛ سند هم به‌صورت پیش‌نویس می‌رود و تأیید نهایی با تأییدکنندهٔ انسانی است.',
      },
    };
  }

  async listDocDrafts() {
    const rows = await this.prisma.aiDocDraft.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
    return { data: rows.map((d) => ({ id: d.id, status: d.status, extractedJson: d.extractedJson, suggestedLinesJson: d.suggestedLinesJson, draftEntryId: d.draftEntryId, createdAt: d.createdAt })) };
  }

  /** تولید پیش‌نویس سند حسابداری از پیش‌نویس هوشمند — هنوز قطعی نمی‌شود؛ تأیید نهایی با گردش کار اسناد است */
  async approveDocDraft(id: string, userId?: string) {
    const draft = await this.prisma.aiDocDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('پیش‌نویس یافت نشد');
    if (draft.status !== 'DRAFT') throw new BadRequestException('این پیش‌نویس قبلاً پردازش شده است');
    const lines = draft.suggestedLinesJson as unknown as Array<{ accountCode: string; debit: string; credit: string; note?: string }>;
    if (!lines?.length) throw new BadRequestException('سطری استخراج نشده بود');
    const debit = lines.reduce((a, l) => a + BigInt(l.debit), 0n);
    const credit = lines.reduce((a, l) => a + BigInt(l.credit), 0n);
    if (debit !== credit) throw new BadRequestException({ code: 'BUSINESS_RULE', message: 'سطرهای پیشنهادی متوازن نیستند' });

    const ex = draft.extractedJson as Record<string, unknown>;
    const entryDate = ex.date ? new Date(String(ex.date) + 'T00:00:00.000Z') : new Date();
    const desc = `AI پیش‌نویس: ${ex.supplierNameFa ?? 'تأمین‌کننده'} — فاکتور ${ex.invoiceNo ?? 'بدون شماره'}`;
    const entry = await this.prisma.$transaction(async (tx) => {
      const seq = await nextDocSeq(tx, 'journal');
      const year = entryDate.getUTCFullYear();
      return tx.journalEntry.create({
        data: {
          entryNo: `JV-${year}-${String(seq).padStart(6, '0')}`,
          entryDate, postingDate: entryDate,
          description: desc, status: 'DRAFT',
          sourceModule: 'bi', sourceRef: `ai-doc:${draft.id}`,
          createdById: userId,
          lines: { create: lines.map((l, i) => ({ lineNo: i + 1, accountCode: l.accountCode, debitRials: BigInt(l.debit), creditRials: BigInt(l.credit), costCenterCode: 'CC-ADMIN' })) },
        },
      });
    });
    const updated = await this.prisma.aiDocDraft.update({
      where: { id }, data: { status: 'DRAFTED', draftEntryId: entry.id, approvedById: userId, approvedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'AI_DOC_DRAFT_ENTRY', entity: 'JournalEntry', entityId: entry.id, reason: `${entry.entryNo} از پیش‌نویس هوشمند` },
    });
    return { data: { id: updated.id, status: updated.status, draftEntryId: entry.id, entryNo: entry.entryNo, note: 'سند به‌صورت پیش‌نویس ساخته شد — تأیید نهایی با نقش تأییدکننده در ماژول حسابداری.' } };
  }

  async discardDocDraft(id: string, userId?: string) {
    const draft = await this.prisma.aiDocDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('پیش‌نویس یافت نشد');
    if (draft.status !== 'DRAFT') throw new BadRequestException('فقط پیش‌نویسِ پردازش‌نشده قابل کنارگذاری است');
    await this.prisma.aiDocDraft.update({ where: { id }, data: { status: 'DISCARDED' } });
    await this.prisma.auditLog.create({ data: { userId, action: 'AI_DOC_DRAFT_DISCARDED', entity: 'AiDocDraft', entityId: id } });
    return { data: { id, status: 'DISCARDED' } };
  }

  // ───────────────────────── F11-T5 — پیش‌بینی تقاضا/اشغال/فروش و پیشنهاد نرخ ─────────────────────────
  async revenueForecast(userId?: string) {
    const today = dayStart(new Date());
    const types = await this.prisma.roomType.findMany({ include: { rooms: { select: { id: true } } } });
    const now = new Date();
    const dow = (now.getUTCDay() + 1) % 7; // 0=شنبه..6=جمعه (تقریب)
    const weekend = dow >= 5; // پنجشنبه/جمعه
    const jalaliMonth = now.getUTCMonth() + 1; // تقریب فصلی
    const seasonFactor = (jalaliMonth >= 2 && jalaliMonth <= 6) ? 1.10 : 1.00; // اردیبهشت..شهریور پرتقاضاتر
    const weekdayFactor = weekend ? 1.15 : 1.00;

    const out: Array<{ roomTypeCode: string; roomTypeFa?: string; baseRials: string; suggestedRials: string; confidenceLow: string; confidenceHigh: string; occupancyRatio: number; reason: string; id?: string; status?: string }> = [];
    for (const t of types) {
      const roomsCount = t.rooms.length;
      if (roomsCount === 0) continue;
      const occupied = await this.prisma.stayRoom.count({ where: { stay: { status: 'OPEN' }, room: { roomTypeId: t.id } } });
      const occRatio = occupied / roomsCount;
      // قاعدهٔ قیمت‌گذاری: پایه × (۱ + فشار تقاضا) × فصل × روز هفته — فشار تقاضا حداکثر ±۲۰٪ نسبت به نیمه‌اشغال
      const demandAdj = Math.max(-0.10, Math.min(0.20, (occRatio - 0.5) * 0.4));
      const factor = 1 + demandAdj;
      const full = factor * seasonFactor * weekdayFactor;
      const suggested = roundTo(BigInt(Math.round(Number(t.baseRateRials) * full)), 100000n);
      const low = roundTo(BigInt(Math.round(Number(suggested) * 0.88)), 100000n);
      const high = roundTo(BigInt(Math.round(Number(suggested) * 1.12)), 100000n);
      const reason = `اشغال فعلی ${(occRatio * 100).toFixed(0)}٪ (ضریب ${full.toFixed(2)}) — فصل ${seasonFactor}، روز هفته ${weekdayFactor}`;
      const existing = await this.prisma.aiRateSuggestion.findFirst({ where: { roomTypeCode: t.code, businessDate: today } });
      const rec = existing
        ? await this.prisma.aiRateSuggestion.update({ where: { id: existing.id }, data: { baseRials: t.baseRateRials, suggestedRials: suggested, confidenceLow: low, confidenceHigh: high, reasonJson: { occupancyRatio: occRatio, seasonFactor, weekdayFactor, demandAdj } as never } })
        : await this.prisma.aiRateSuggestion.create({ data: { roomTypeCode: t.code, businessDate: today, baseRials: t.baseRateRials, suggestedRials: suggested, confidenceLow: low, confidenceHigh: high, reasonJson: { occupancyRatio: occRatio, seasonFactor, weekdayFactor, demandAdj } as never, createdById: userId } });
      out.push({ roomTypeCode: t.code, roomTypeFa: (t as { nameFa?: string }).nameFa, baseRials: t.baseRateRials.toString(), suggestedRials: suggested.toString(), confidenceLow: low.toString(), confidenceHigh: high.toString(), occupancyRatio: Number(occRatio.toFixed(2)), reason, id: rec.id, status: rec.status });
    }
    await this.prisma.auditLog.create({ data: { userId, action: 'AI_REVENUE_FORECAST', entity: 'AiRateSuggestion', entityId: null, reason: `${out.length} نوع اتاق` } });
    return {
      data: { businessDate: today.toISOString().slice(0, 10), suggestions: out },
      meta: { rule: 'نسخهٔ قاعده‌محور (اشغال/فصل/روز هفته) — پیشنهاد است؛ اعمال نرخ فقط با تصمیم ثبت‌شدهٔ مدیر' },
    };
  }

  async decideRate(id: string, action: 'APPROVE' | 'REJECT', userId?: string) {
    const rec = await this.prisma.aiRateSuggestion.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('پیشنهاد یافت نشد');
    if (rec.status !== 'DRAFT') throw new BadRequestException('این پیشنهاد قبلاً تصمیم‌گیری شده است');
    const updated = await this.prisma.aiRateSuggestion.update({
      where: { id }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: userId, decidedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: `AI_RATE_${action}`, entity: 'AiRateSuggestion', entityId: id, reason: `${rec.roomTypeCode} → ${rec.suggestedRials.toString()}` },
    });
    return { data: { id: updated.id, status: updated.status, roomTypeCode: updated.roomTypeCode, suggestedRials: updated.suggestedRials.toString() } };
  }

  async listRateSuggestions(date?: string) {
    const d = date ? new Date(date + 'T00:00:00.000Z') : dayStart(new Date());
    const rows = await this.prisma.aiRateSuggestion.findMany({ where: { businessDate: d }, orderBy: { roomTypeCode: 'asc' } });
    return { data: rows.map((r) => ({ id: r.id, roomTypeCode: r.roomTypeCode, businessDate: r.businessDate, baseRials: r.baseRials.toString(), suggestedRials: r.suggestedRials.toString(), confidenceLow: r.confidenceLow.toString(), confidenceHigh: r.confidenceHigh.toString(), status: r.status, reasonJson: r.reasonJson })) };
  }

  // ───────────────────────── F11-T6 — هشدار ناهنجاری مالی + تحلیل شکایات/احساسات ─────────────────────────
  async anomalies(userId?: string) {
    const now = new Date();
    const from = addDays(dayStart(now), -60);
    const findings: Array<{ type: string; severity: 'info' | 'warning' | 'critical'; messageFa: string; refs?: string[] }> = [];

    // ۱) نمرهٔ z درآمد روزانه (۶۰ روز)
    const revLines = await this.prisma.journalLine.findMany({
      where: { entry: { status: 'POSTED', postingDate: { gte: from } }, accountCode: { in: REVENUE_ACCOUNTS } },
      select: { debitRials: true, creditRials: true, entry: { select: { postingDate: true } } },
    });
    const byDay = new Map<string, bigint>();
    for (const l of revLines) {
      const k = (l.entry.postingDate ?? new Date()).toISOString().slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0n) + (l.creditRials - l.debitRials));
    }
    const days = [...byDay.entries()].map(([k, v]) => ({ day: k, v: Number(v) }));
    if (days.length >= 14) {
      const mean = days.reduce((a, x) => a + x.v, 0) / days.length;
      const sd = Math.sqrt(days.reduce((a, x) => a + (x.v - mean) ** 2, 0) / days.length);
      if (sd > 0) {
        for (const x of days) {
          const z = (x.v - mean) / sd;
          if (Math.abs(z) > 3) {
            findings.push({ type: 'REVENUE_ZSCORE', severity: z > 0 ? 'info' : 'warning', messageFa: `درآمد روز ${x.day} از میانگین بیش از ۳ انحراف معیار فاصله دارد (${z.toFixed(1)}σ)`, refs: [x.day] });
          }
        }
      }
    }

    // ۲) خطوط غیرعادی بزرگ (> میانگین + ۳σ)
    const allLines = await this.prisma.journalLine.findMany({
      where: { entry: { status: 'POSTED', postingDate: { gte: from } } },
      select: { id: true, accountCode: true, debitRials: true, creditRials: true, entryId: true },
    });
    const amts = allLines.map((l) => Number(l.debitRials > l.creditRials ? l.debitRials : l.creditRials));
    const mAmt = amts.reduce((a, x) => a + x, 0) / (amts.length || 1);
    const sdAmt = Math.sqrt(amts.reduce((a, x) => a + (x - mAmt) ** 2, 0) / (amts.length || 1));
    if (sdAmt > 0) {
      for (const l of allLines) {
        const amt = Number(l.debitRials > l.creditRials ? l.debitRials : l.creditRials);
        if (amt > mAmt + 3 * sdAmt && amt > 0) {
          findings.push({ type: 'LARGE_LINE', severity: 'warning', messageFa: `سطر حساب ${l.accountCode} با مبلغ ${amt.toLocaleString('fa-IR')} ریال بسیار بزرگ‌تر از الگوی معمول است`, refs: [l.entryId] });
        }
      }
    }

    // ۳) پرداخت تکراری مشکوک — بستانکار ۲۱۰۱ هم‌مبلغ در ۲ روز
    const payLines = await this.prisma.journalLine.findMany({
      where: { accountCode: '2101', creditRials: { gt: 0n }, entry: { status: 'POSTED', postingDate: { gte: addDays(dayStart(now), -30) } } },
      select: { creditRials: true, entryId: true, entry: { select: { postingDate: true, description: true } } },
    });
    for (let i = 0; i < payLines.length; i++) {
      for (let j = i + 1; j < payLines.length; j++) {
        const a = payLines[i], b = payLines[j];
        if (a.creditRials === b.creditRials && a.entryId !== b.entryId) {
          const da = (a.entry.postingDate ?? new Date()).getTime();
          const db = (b.entry.postingDate ?? new Date()).getTime();
          if (Math.abs(da - db) <= 2 * 24 * 3600 * 1000) {
            findings.push({ type: 'DUP_PAYMENT', severity: 'critical', messageFa: `دو پرداخت هم‌مبلغ ${a.creditRials.toLocaleString('fa-IR')} ریال در فاصلهٔ حداکثر ۲ روز — احتمال پرداخت دوبله`, refs: [a.entryId, b.entryId] });
          }
        }
      }
    }

    // ۴) ماندهٔ منفی صندوق
    const cash = await this.accountBalance(['1101']);
    if (cash < 0n) findings.push({ type: 'NEGATIVE_CASH', severity: 'critical', messageFa: `ماندهٔ صندوق منفی است (${cash.toLocaleString('fa-IR')} ریال) — مغایرت کنترلی`, refs: ['1101'] });

    // ۵) پیش‌نویس معلق بیش از ۷ روز
    const stale = await this.prisma.journalEntry.findMany({
      where: { status: 'DRAFT', entryDate: { lt: addDays(dayStart(now), -7) } },
      select: { entryNo: true, entryDate: true },
    });
    for (const s of stale) findings.push({ type: 'STALE_DRAFT', severity: 'warning', messageFa: `سند پیش‌نویس ${s.entryNo} بیش از ۷ روز معلق است`, refs: [s.entryNo] });

    // ۶) تحلیل احساسات رخدادهای اخیر (لغو/تأخیر/کسری… در برابر تأیید/تسویه)
    const logs = await this.prisma.auditLog.findMany({
      where: { createdAt: { gte: addDays(dayStart(now), -7) }, reason: { not: null } },
      select: { reason: true, action: true, entity: true },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
    let neg = 0, pos = 0;
    const samples: string[] = [];
    for (const l of logs) {
      const txt = `${l.reason ?? ''} ${l.action}`;
      const isNeg = NEGATIVE_WORDS.some((w) => txt.includes(w));
      const isPos = POSITIVE_WORDS.some((w) => txt.includes(w));
      if (isNeg && !isPos) {
        neg++;
        if (samples.length < 5) samples.push(`${l.action}: ${(l.reason ?? '').slice(0, 60)}`);
      } else if (isPos && !isNeg) pos++;
    }
    const sentiment = { negativeCount: neg, positiveCount: pos, ratio: neg + pos ? Number((neg / (neg + pos)).toFixed(2)) : 0, samples };

    await this.prisma.auditLog.create({
      data: { userId, action: 'BI_ANOMALIES', entity: 'BiService', entityId: null, reason: `${findings.length} یافته؛ منفی ${neg}/مثبت ${pos}` },
    });
    return {
      data: { from: from.toISOString().slice(0, 10), findings, sentiment },
      meta: { rule: 'قواعد آماری (z-score، دوبلهٔ پرداخت، ماندهٔ منفی، معلق‌ماندن) + تحلیل واژگانی احساسات — ثبت در حسابرسی' },
    };
  }
}
