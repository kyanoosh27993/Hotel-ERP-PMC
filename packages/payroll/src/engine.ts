/**
 * engine.ts — موتور محاسبه فیش حقوق — پورت TypeScript تأییدشده از v0.1
 * (apps/web/assets/js/payroll-engine.js — همان فرمول‌ها، همان گردکردن، همان اعداد مرجع).
 * مالیات/بیمه/ناخالص همه ریال صحیح؛ محاسبات داخلی float فقط برای فرمول‌های قانون کار
 * با گردکردن نهایی به ریال صحیح (همان رفتار مرجع payroll-releases).
 */
import { LAW_PARAMS, LAW_PARAMS_VERSION, salaryTax, type TaxBracket } from './params';

export interface EmployeeInput {
  code: string;
  firstName: string;
  lastName: string;
  /** متأهل؟ (عائله‌مندی) */
  marital: boolean;
  /** تعداد افراد تحت تکفل */
  dependents: number;
  /** حق شغل / دستمزد پایه ماهانه (ریال) */
  baseSalary: number;
  /** پایه سنوات ماهانه (ریال) */
  seniority: number;
  /** حق مسکن ماهانه (ریال) */
  housing: number;
  iban?: string;
}

export interface SlipOverrides {
  overtimeHours?: number;
  nightShifts?: number;
  absentDays?: number;
}

export interface PayrollSlip {
  code: string;
  name: string;
  period: string;
  mizan: number;
  daily: number;
  hourly: number;
  overtime: number;
  night: number;
  housing: number;
  childAllow: number;
  absent: number;
  gross: number;
  insEmployee: number;
  insEmployer: number;
  monthlyTaxable: number;
  annualTaxable: number;
  tax: number;
  net: number;
  iban: string;
  paramsVersion: string;
  params: Required<SlipOverrides>;
}

const round = (x: number): number => Math.round(x);

/** محاسبه فیش یک پرسنل برای یک دوره شمسی (مثل '1405-09') */
export function calcSlip(
  p: EmployeeInput,
  period: string,
  opt: SlipOverrides = {},
  brackets?: TaxBracket[],
): PayrollSlip {
  const L = LAW_PARAMS.labor;
  const I = LAW_PARAMS.insurance;
  const overtimeHours = opt.overtimeHours ?? 0;
  const nightShifts = opt.nightShifts ?? 0;
  const absentDays = opt.absentDays ?? 0;

  const mizan = (Number(p.baseSalary) || 0) + (Number(p.seniority) || 0);
  const daily = mizan / 30;
  const hourly = daily / L.hourlyDivisor.value;
  const overtime = overtimeHours * hourly * L.overtimeRate.value;
  // شب‌کاری غیرموظفی: ۱۰۰٪ اضافه + ۷۵٪ اضافه‌مزد → فقط جزء اضافه در ناخالص
  const night = nightShifts * hourly * (L.nightShiftRate.value - 1);
  const absent = absentDays * daily;
  const housing = Number(p.housing) || 0;
  const childAllow = p.marital
    ? (Number(p.dependents) || 0) * LAW_PARAMS.childAllowanceMonthly.value
    : 0;

  const gross = mizan + overtime + night + housing + childAllow - absent;

  // بیمه: ۳۰٪ مبنای مشمول (دستمزد+اضافه‌کار+شب‌کاری − غیبت) — بدون حق مسکن و عائله‌مندی
  const insBase = mizan + overtime + night - absent;
  const insEmployee = round(insBase * I.employeeRate.value);
  const insEmployer = round(insBase * I.employerRate.value);

  // مالیات حقوق: مشمول ماهانه × ۱۲ − معافیت سالانه → پلکانی (ریال/سال) → تقسیم ۱۲
  const monthlyTaxable = Math.max(0, gross - insEmployee - housing - childAllow);
  const annualTaxable = monthlyTaxable * 12;
  const annualExempt = LAW_PARAMS.incomeTax.annualExemption.value;
  const taxAnnual = salaryTax(Math.max(0, annualTaxable - annualExempt), brackets);
  const taxMonthly = round(taxAnnual / 12);

  const net = gross - insEmployee - taxMonthly;

  return {
    code: p.code,
    name: `${p.firstName} ${p.lastName}`,
    period,
    mizan: round(mizan),
    daily: round(daily),
    hourly: round(hourly),
    overtime: round(overtime),
    night: round(night),
    housing,
    childAllow,
    absent: round(absent),
    gross: round(gross),
    insEmployee,
    insEmployer,
    monthlyTaxable: round(monthlyTaxable),
    annualTaxable,
    tax: taxMonthly,
    net: round(net),
    iban: p.iban ?? '',
    paramsVersion: LAW_PARAMS_VERSION,
    params: { overtimeHours, nightShifts, absentDays },
  };
}

export interface RunResult {
  period: string;
  paramsVersion: string;
  slips: PayrollSlip[];
  totals: {
    gross: number;
    net: number;
    tax: number;
    insuranceEmployee: number;
    insuranceEmployer: number;
    insuranceTotal: number;
    count: number;
  };
  /** فاقد حکم تأییدشده — در اجرای دوره رد می‌شوند و در گزارش می‌آیند */
  skipped: Array<{ code: string; name: string; reason: string }>;
}

/** محاسبه کل دوره (فقط پرسنل با مبنای محاسبه معتبر) */
export function runPeriod(
  personnel: Array<{ employee: EmployeeInput; overrides?: SlipOverrides }>,
  period: string,
): RunResult {
  const slips: PayrollSlip[] = [];
  const skipped: RunResult['skipped'] = [];
  for (const row of personnel) {
    if (!row.employee.baseSalary || row.employee.baseSalary <= 0) {
      skipped.push({
        code: row.employee.code,
        name: `${row.employee.firstName} ${row.employee.lastName}`,
        reason: 'NO_VALID_DECISION',
      });
      continue;
    }
    slips.push(calcSlip(row.employee, period, row.overrides ?? {}));
  }
  const sum = (fn: (s: PayrollSlip) => number): number => slips.reduce((acc, s) => acc + fn(s), 0);
  return {
    period,
    paramsVersion: LAW_PARAMS_VERSION,
    slips,
    skipped,
    totals: {
      gross: sum((s) => s.gross),
      net: sum((s) => s.net),
      tax: sum((s) => s.tax),
      insuranceEmployee: sum((s) => s.insEmployee),
      insuranceEmployer: sum((s) => s.insEmployer),
      insuranceTotal: sum((s) => s.insEmployee + s.insEmployer),
      count: slips.length,
    },
  };
}

/** لیست مالیات حقوق (قالب ارسال به my.tax.gov.ir) */
export function taxList(slips: Array<{
  code: string;
  name: string;
  monthlyTaxable: number;
  tax: number;
  period: string;
}>): Array<{ code: string; name: string; monthlyTaxable: number; tax: number; period: string }> {
  return slips.map((s) => ({
    code: s.code,
    name: s.name,
    monthlyTaxable: s.monthlyTaxable,
    tax: s.tax,
    period: s.period,
  }));
}

/** لیست بیمه تأمین اجتماعی (سهم کارگر ۷٪ + کارفرما ۲۳٪ = ۳۰٪) */
export function insuranceList(slips: Array<{
  code: string;
  name: string;
  mizan: number;
  overtime: number;
  night: number;
  absent: number;
  insEmployee: number;
  insEmployer: number;
  period: string;
}>): Array<{
  code: string;
  name: string;
  base: number;
  employee7: number;
  employer23: number;
  total: number;
  period: string;
}> {
  return slips.map((s) => ({
    code: s.code,
    name: s.name,
    base: s.mizan + s.overtime + s.night - s.absent,
    employee7: s.insEmployee,
    employer23: s.insEmployer,
    total: s.insEmployee + s.insEmployer,
    period: s.period,
  }));
}

/** لیست بانک (کد پرسنلی + شبا + خالص پرداختی) */
export function bankList(slips: Array<{
  code: string;
  name: string;
  iban: string;
  net: number;
  period: string;
}>): Array<{ code: string; name: string; iban: string; net: number; period: string }> {
  return slips.map((s) => ({
    code: s.code,
    name: s.name,
    iban: s.iban,
    net: s.net,
    period: s.period,
  }));
}
