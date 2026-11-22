/**
 * params.ts — پارامترهای قانونی نسخه‌دار حقوق (قانون ۱۶ مالک: هیچ عددی حدس زده نمی‌شود).
 * پورت تأییدشده از apps/web/assets/js/laws-params.js (v0.1 — ۳۲/۳۲ تست سبز).
 * مقادیر verified=false یعنی [نیازمند تأیید بخشنامه رسمی] و در گزارش‌ها برچسب می‌خورند.
 */

export interface LawParam<T> {
  value: T;
  verified: boolean;
  note?: string;
}

export interface TaxBracket {
  /** شروع پله (ریال/سال) */
  from: number;
  /** پایان پله (null = بی‌نهایت) */
  to: number | null;
  /** نرخ (۰ تا ۱) */
  rate: number;
}

/** پله‌های پیش‌فرض مالیات حقوق ۱۴۰۵ (ریال/سال) — پله اول = معافیت قانونی سال */
export const DEFAULT_BRACKETS_1405: TaxBracket[] = [
  { from: 0, to: 4_800_000_000, rate: 0.0 },
  { from: 4_800_000_000, to: 24_000_000_000, rate: 0.1 },
  { from: 24_000_000_000, to: 36_000_000_000, rate: 0.15 },
  { from: 36_000_000_000, to: 48_000_000_000, rate: 0.2 },
  { from: 48_000_000_000, to: 60_000_000_000, rate: 0.25 },
  { from: 60_000_000_000, to: null, rate: 0.3 },
];

/** نسخه پارامترها — در هر فیش و هر اجرای دوره ثبت می‌شود (snapshot) */
export const LAW_PARAMS_VERSION = 'laws-1405.1';

export const LAW_PARAMS = {
  year: 1405,
  labor: {
    minimumDailyWage: { value: 5_541_850, verified: true } as LawParam<number>,
    minimumMonthlyWage: { value: 166_255_500, verified: true } as LawParam<number>,
    housingAllowance: { value: 30_000_000, verified: true } as LawParam<number>,
    hourlyDivisor: { value: 7.33, verified: true } as LawParam<number>,
    overtimeRate: { value: 1.4, verified: true } as LawParam<number>,
    nightShiftRate: { value: 1.75, verified: true } as LawParam<number>,
    fridayNoRestRate: { value: 1.8, verified: true } as LawParam<number>,
    fridayWithRestRate: { value: 1.4, verified: true } as LawParam<number>,
  },
  insurance: {
    totalRate: { value: 0.3, verified: true } as LawParam<number>,
    employerRate: { value: 0.23, verified: true } as LawParam<number>,
    employeeRate: { value: 0.07, verified: true } as LawParam<number>,
    ceiling: { value: null, verified: false, note: '[نیازمند تأیید بخشنامه رسمی ۱۴۰۵]' } as LawParam<number | null>,
  },
  incomeTax: {
    monthlyExemption: { value: 400_000_000, verified: true } as LawParam<number>,
    annualExemption: { value: 4_800_000_000, verified: true } as LawParam<number>,
    /** نرخ پلکانی ۱۰٪ تا ۳۰٪ تأیید؛ مرز دقیق پله‌ها پارامتریک تا ابلاغ بخشنامه رسمی ۱۴۰۵ */
    brackets: {
      verified: false,
      note: '[نیازمند بخشنامه رسمی ۱۴۰۵ — مرزهای پله‌ها قابل ویرایش‌اند]',
      rows: DEFAULT_BRACKETS_1405,
    },
  },
  /** معادل ماهانه عائله‌مندی هر فرزند — [نیازمند بخشنامه رسمی ۱۴۰۵] */
  childAllowanceMonthly: { value: 554_185, verified: false } as LawParam<number>,
};

/**
 * مالیات حقوق پلکانی (ریال/سال) — پورت دقیق v0.1؛ پله‌ها قابل جایگزینی با بخشنامه رسمی.
 * همان معادلهٔ ۳۲/۳۲ تست سبز: salaryTax(400m*12)=0 و salaryTax(5.8B)=۱۰٪ مازاد.
 */
export function salaryTax(
  annualTaxableRial: number,
  brackets: TaxBracket[] = DEFAULT_BRACKETS_1405,
): number {
  let tax = 0;
  for (const row of brackets) {
    if (annualTaxableRial <= row.from) break;
    const top = row.to === null || annualTaxableRial < row.to ? annualTaxableRial : row.to;
    tax += (top - row.from) * row.rate;
  }
  return Math.round(tax);
}
