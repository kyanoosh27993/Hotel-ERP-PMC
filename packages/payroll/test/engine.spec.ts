/**
 * engine.spec.ts — سناریوهای قراردادی حقوق (پورت دقیق تست‌های v0.1 ۳۲/۳۲) + شبا + اجرای دوره.
 * منبع اعداد: docs/11-iran-compliance/IRAN-LAWS.md + پارامترهای تأیید ۱۴۰۵.
 */
import {
  LAW_PARAMS, LAW_PARAMS_VERSION, salaryTax, DEFAULT_BRACKETS_1405,
  calcSlip, runPeriod, taxList, insuranceList, bankList,
  isValidIranIban, buildIranIban, type EmployeeInput,
} from '../src';
import { addRials } from '@hotel-erp/shared';

const EMP: EmployeeInput = {
  code: '101',
  firstName: 'علی',
  lastName: 'محمدی',
  marital: true,
  dependents: 2,
  baseSalary: 220_000_000,
  housing: 30_000_000,
  seniority: 16_666_600,
  iban: 'IR12',
};

describe('پارامترهای قانونی ۱۴۰۵ (تأییدشده)', () => {
  it('معافیت سالانه مالیات ۴٫۸ میلیارد ریال', () => {
    expect(LAW_PARAMS.incomeTax.annualExemption.value).toBe(4_800_000_000);
  });

  it('بیمه ۳۰٪ = ۲۳٪ کارفرما + ۷٪ کارگر', () => {
    const sum = LAW_PARAMS.insurance.employerRate.value + LAW_PARAMS.insurance.employeeRate.value;
    expect(Math.abs(sum - 0.3)).toBeLessThan(1e-9);
  });

  it('مالیات صفر زیر معافیت', () => {
    expect(salaryTax(400_000_000 * 12)).toBe(0);
  });

  it('مالیات پله اول ۱۰٪', () => {
    expect(salaryTax(5_800_000_000)).toBe(Math.round(1_000_000_000 * 0.1));
  });

  it('پلکانی تا ۳۰٪ و ورودی خارج از محدوده', () => {
    // ۶۵ میلیارد سالانه: مازاد هر پله با نرخ خودش
    const expected =
      (24_000_000_000 - 4_800_000_000) * 0.1 +
      (36_000_000_000 - 24_000_000_000) * 0.15 +
      (48_000_000_000 - 36_000_000_000) * 0.2 +
      (60_000_000_000 - 48_000_000_000) * 0.25 +
      (65_000_000_000 - 60_000_000_000) * 0.3;
    expect(salaryTax(65_000_000_000)).toBe(Math.round(expected));
    expect(salaryTax(-1)).toBe(0);
    // پله‌های سفارشی جایگزین بخشنامه
    expect(salaryTax(10_000_000_000, [{ from: 0, to: 5_000_000_000, rate: 0 }, { from: 5_000_000_000, to: null, rate: 0.2 }])).toBe(1_000_000_000);
    expect(DEFAULT_BRACKETS_1405).toHaveLength(6);
  });
});

describe('موتور حقوق — فرمول‌های قراردادی (پورت v0.1)', () => {
  const slip = calcSlip(EMP, '1405-09', { overtimeHours: 10, nightShifts: 4, absentDays: 1 });

  it('مزد مبنا = شغل + سنوات', () => {
    expect(slip.mizan).toBe(220_000_000 + 16_666_600);
  });

  it('ناخالص > صفر و شامل مزایا', () => {
    expect(slip.gross).toBeGreaterThan(0);
    expect(slip.childAllow).toBe(2 * LAW_PARAMS.childAllowanceMonthly.value);
    expect(slip.housing).toBe(30_000_000);
  });

  it('سهم بیمه کارگر = ۷٪ مبنای مشمول (بدون مسکن/عائله‌مندی)', () => {
    const base = slip.mizan + slip.overtime + slip.night - slip.absent;
    expect(slip.insEmployee).toBe(Math.round(base * 0.07));
    expect(slip.insEmployer).toBe(Math.round(base * 0.23));
  });

  it('خالص = ناخالص − بیمه کارگر − مالیات', () => {
    expect(slip.net).toBe(slip.gross - slip.insEmployee - slip.tax);
  });

  it('snapshot نسخه پارامترها در فیش ثبت می‌شود', () => {
    expect(slip.paramsVersion).toBe(LAW_PARAMS_VERSION);
    expect(slip.params).toEqual({ overtimeHours: 10, nightShifts: 4, absentDays: 1 });
  });

  it('متأهل نبودن → بدون عائله‌مندی؛ غیبت صفر → کسر صفر', () => {
    const s2 = calcSlip({ ...EMP, marital: false, dependents: 0 }, '1405-09', {});
    expect(s2.childAllow).toBe(0);
    expect(s2.absent).toBe(0);
    expect(s2.net).toBe(s2.gross - s2.insEmployee - s2.tax);
  });
});

describe('اجرا و لیست‌های رسمی', () => {
  const emp2: EmployeeInput = { ...EMP, code: '102', firstName: 'سارا', lastName: 'کریمی', baseSalary: 180_000_000, iban: buildIranIban('0170000000000000000002') };
  const run = runPeriod(
    [
      { employee: EMP, overrides: { overtimeHours: 10 } },
      { employee: emp2 },
      { employee: { ...EMP, code: '103', baseSalary: 0 }, }, // بدون حکم معتبر → رد
    ],
    '1405-09',
  );

  it('جمع دوره = جمع فیش‌ها (با addRials صحیح)', () => {
    const manualNet = run.slips.reduce((acc, s) => acc + BigInt(s.net), 0n);
    expect(BigInt(run.totals.net)).toBe(addRials(...run.slips.map((s) => s.net)));
    expect(manualNet).toBe(BigInt(run.totals.net));
    expect(run.totals.count).toBe(2);
  });

  it('فاقد حکم → لیست ردشدگان با دلیل', () => {
    expect(run.skipped).toEqual([{ code: '103', name: 'علی محمدی', reason: 'NO_VALID_DECISION' }]);
  });

  it('لیست بیمه: جمع ۳۰٪ و مبنای مشمول', () => {
    const rows = insuranceList(run.slips);
    expect(rows).toHaveLength(run.slips.length);
    for (const r of rows) {
      expect(r.total).toBe(r.employee7 + r.employer23);
      const slipRow = run.slips.find((s) => s.code === r.code)!;
      expect(r.base).toBe(slipRow.mizan + slipRow.overtime + slipRow.night - slipRow.absent);
    }
  });

  it('لیست مالیات و لیست بانک', () => {
    const t = taxList(run.slips);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ code: '101', period: '1405-09' });
    const b = bankList(run.slips);
    expect(b[0].iban).toBe('IR12');
    expect(b[1].net).toBe(run.slips[1].net);
  });
});

describe('شبا ایران (mod-97)', () => {
  it('تولید و اعتبارسنجی متقابل', () => {
    const iban = buildIranIban('0170000000123456789012');
    expect(iban).toHaveLength(26);
    expect(iban.startsWith('IR')).toBe(true);
    expect(isValidIranIban(iban)).toBe(true);
  });

  it('شبا نامعتبر رد می‌شود', () => {
    expect(isValidIranIban('IR1201700000012345678901234')).toBe(false); // checksum غلط
    expect(isValidIranIban('IR99')).toBe(false);
    expect(isValidIranIban('')).toBe(false);
    expect(isValidIranIban(undefined as never)).toBe(false);
    const valid = buildIranIban('0190000000000000000001');
    expect(isValidIranIban(valid.toLowerCase())).toBe(true); // حساس به بزرگی حروف نیست
    expect(() => buildIranIban('123')).toThrow(); // BBAN باید ۲۲ رقم باشد
  });
});
