/**
 * jalali.ts — پورت TypeScript از موتور تقویم هجری شمسی تأییدشده v0.1
 * (apps/web/assets/js/jalali.js — کبیسه ۱۴۰۳/۱۲/۳۰ تست شده؛ پوشش سال −۶۰ تا ۳۱۷۷)
 * ذخیره استاندارد UTC در پایگاه داده؛ این ماژول فقط برای محاسبه و نمایش است.
 */

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
  1637, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
];

export interface JalaaliDate { jy: number; jm: number; jd: number }
export interface GregorianDate { gy: number; gm: number; gd: number }

function div(a: number, b: number): number { return Math.trunc(a / b); }
function mod(a: number, b: number): number { return a - Math.trunc(a / b) * b; }

function jalCal(jy: number, withoutLeap: boolean): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  let leap = 0;
  let n = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (!withoutLeap) {
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
  }
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): GregorianDate {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): JalaaliDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function isLeapJalaali(jy: number): boolean {
  return jalCal(jy, false).leap === 0;
}

export function jalaaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaali(jy) ? 30 : 29;
}

export function isValidJalaali(jy: number, jm: number, jd: number): boolean {
  return (
    jy >= -60 && jy <= 3177 && jm >= 1 && jm <= 12 &&
    jd >= 1 && jd <= jalaaliMonthLength(jy, jm)
  );
}

export function toJalaali(gy: number, gm: number, gd: number): JalaaliDate {
  return d2j(g2d(gy, gm, gd));
}

export function toGregorian(jy: number, jm: number, jd: number): GregorianDate {
  return d2g(j2d(jy, jm, jd));
}

function pad(x: number | string, n: number): string {
  let s = String(x);
  while (s.length < n) s = '0' + s;
  return s;
}

/** فرمت استاندارد نمایش شمسی: YYYY/MM/DD */
export function formatJalaali(jy: number, jm: number, jd: number): string {
  return `${pad(jy, 4)}/${pad(jm, 2)}/${pad(jd, 2)}`;
}

/** YYYY/MM/DD شمسی → {jy,jm,jd} یا null اگر نامعتبر */
export function parseJalaali(s: string | null | undefined): JalaaliDate | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{3,4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (!isValidJalaali(jy, jm, jd)) return null;
  return { jy, jm, jd };
}

/** شیء Date (تاریخ محلی) → رشته شمسی YYYY/MM/DD */
export function jalaaliFromDate(d: Date): string {
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return formatJalaali(j.jy, j.jm, j.jd);
}

/** رشته شمسی → ISO-8601 نیمه‌شب آن روز (تاریخ محلی تهران) */
export function jalaaliToIso(s: string, hour = 0, minute = 0): string | null {
  const j = parseJalaali(s);
  if (!j) return null;
  const g = toGregorian(j.jy, j.jm, j.jd);
  const d = new Date(g.gy, g.gm - 1, g.gd, hour, minute);
  return d.toISOString();
}

/** روز هفته شمسی: 0=شنبه … 6=جمعه */
export function jalaaliDayOfWeek(jy: number, jm: number, jd: number): number {
  const g = toGregorian(jy, jm, jd);
  const dow = new Date(g.gy, g.gm - 1, g.gd).getDay(); // 0=یکشنبه
  return (dow + 1) % 7;
}

export const JALAALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const JALAALI_DAY_NAMES = [
  'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه',
];
