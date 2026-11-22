/**
 * iban.ts — اعتبارسنجی/تولید شبا ایران (IR، ۲۶ کاراکتر) — الگوریتم mod-97 استاندارد ISO 13616.
 * لیست بانک فقط با شبا معتبر پذیرفته می‌شود (فاز ۲ — F2-T4).
 */

/** اعتبارسنجی شبا: true فقط برای IR + ۲۴ رقم با checksum صحیح */
export function isValidIranIban(iban: string): boolean {
  const s = (iban ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^IR\d{24}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4); // BBAN + IRxx
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  // mod-97 روی رشته بزرگ — رقم به رقم
  let remainder = 0;
  for (const d of numeric) {
    remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** محاسبه رقم‌های کنترل برای BBAN ۲۲رقمی (بانک ۳ رقم + حساب ۱۹ رقم) → شبا کامل معتبر */
export function buildIranIban(bban22: string): string {
  if (!/^\d{22}$/.test(bban22)) throw new Error('BBAN must be 22 digits');
  const checkBase = `${bban22}IR00`;
  const numeric = checkBase.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let remainder = 0;
  for (const d of numeric) {
    remainder = (remainder * 10 + Number(d)) % 97;
  }
  const check = String(98 - remainder).padStart(2, '0');
  return `IR${check}${bban22}`;
}
