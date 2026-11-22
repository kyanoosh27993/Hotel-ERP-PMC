/**
 * money.ts — پول با عدد صحیح (قانون ۴ قرارداد: ممیز شناور مطلقاً ممنوع)
 * واحد پایه: ریال (قانون ۶). نمایش تومان فقط در لایه نمایش.
 */

export class MoneyError extends Error {}

/** اطمینان از صحت عدد صحیح ریال — هر ورودی ممیز شناور یا غیرعددی رد می‌شود */
export function assertRial(amount: number | bigint, label = 'amount'): bigint {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw new MoneyError(`${label} باید عدد صحیح ریال باشد، ممیز شناور ممنوع: ${amount}`);
    }
    return BigInt(amount);
  }
  throw new MoneyError(`${label} نوع نامعتبر دارد — فقط number صحیح یا bigint مجاز است`);
}

/** جمع امن چند مبلغ ریال (ورودی‌ها صحت‌سنجی می‌شوند) */
export function addRials(...amounts: (number | bigint)[]): bigint {
  return amounts.reduce<bigint>((acc, a) => acc + assertRial(a), 0n);
}

/** تفریق امن */
export function subRials(a: number | bigint, b: number | bigint): bigint {
  return assertRial(a) - assertRial(b);
}

/** ضرب در عدد صحیح (تعداد × مبلغ واحد) */
export function mulRial(amount: number | bigint, qty: number | bigint): bigint {
  return assertRial(amount) * BigInt(qty);
}

/**
 * تقسیم ریال بین n سهم بدون از دست دادن ریال (باقیمانده به ترتیب به سهم‌های اول تخصیص می‌یابد).
 * کاربرد: تقسیم تخفیف/مالیات روی چند ردیف فاکتور — جمع خروجی همیشه برابر کل است.
 */
export function splitRial(total: number | bigint, n: number): bigint[] {
  const t = assertRial(total);
  if (!Number.isInteger(n) || n < 1) throw new MoneyError(`n باید عدد صحیح >= 1 باشد: ${n}`);
  const base = t / BigInt(n);
  const rem = t % BigInt(n);
  const parts: bigint[] = [];
  for (let i = 0; i < n; i += 1) parts.push(base + (i < rem ? (rem >= 0 ? 1n : -1n) : 0n));
  return parts;
}

/** صحت‌سنجی تراز سند دوطرفه: جمع بدهکار == جمع بستانکار */
export function isBalanced(debits: (number | bigint)[], credits: (number | bigint)[]): boolean {
  return addRials(...debits) === addRials(...credits);
}

/* ── نمایش (فقط لایه UI — هرگز وارد محاسبات نشود) ── */

/** هزارجداکننده لاتین: 1234567 → "1,234,567" */
export function formatWithSeparators(amount: number | bigint): string {
  const sign = assertRial(amount) < 0n ? '-' : '';
  const digits = (assertRial(amount) < 0n ? -assertRial(amount) : assertRial(amount)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** تبدیل ارقام لاتین به فارسی (فقط نمایش) */
export function toFaDigits(s: string): string {
  const map: Record<string, string> = { '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' };
  return s.replace(/[0-9]/g, (d) => map[d] ?? d);
}

/** نمایش ریال فارسی: "۱٬۲۳۴٬۵۶۷ ریال" */
export function formatRialFa(amount: number | bigint): string {
  return toFaDigits(formatWithSeparators(amount)).replace(/,/g, '٬') + ' ریال';
}

/** نمایش تومان (فقط نمایش؛ محاسبه همیشه ریال) */
export function rialToToman(amount: number | bigint): number {
  const r = assertRial(amount);
  if (r % 10n !== 0n) throw new MoneyError('مبلغ ریال برای تبدیل تومان باید مضرب ۱۰ باشد');
  return Number(r / 10n);
}

/** تبدیل عدد ورودی کاربر (فارسی/لاتین، با جداکننده) به ریال صحیح */
export function parseUserAmount(input: string): bigint {
  const faMap: Record<string, string> = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
  const normalized = input
    .replace(/[۰-۹]/g, (d) => faMap[d] ?? d)
    .replace(/[,\s٬]/g, '');
  if (!/^-?\d+$/.test(normalized)) throw new MoneyError(`ورودی مبلغ نامعتبر است: ${input}`);
  return BigInt(normalized);
}
