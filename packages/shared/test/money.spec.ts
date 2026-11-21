import {
  assertRial, addRials, subRials, mulRial, splitRial, isBalanced,
  formatWithSeparators, toFaDigits, formatRialFa, rialToToman, parseUserAmount, MoneyError,
} from '../src/money';

describe('money — ریال با عدد صحیح (قانون ۴)', () => {
  it('ممیز شناور را مطلقاً رد می‌کند', () => {
    expect(() => assertRial(10.5)).toThrow(MoneyError);
    expect(() => assertRial(0.1)).toThrow(MoneyError);
    expect(() => assertRial('x' as never)).toThrow();
    expect(assertRial(10)).toBe(10n);
  });

  it('جمع و تفریق صحیح باقی می‌ماند (بدون خطای گردکردن)', () => {
    // مثال کلاسیک ممیز شناور: 0.1+0.2 — اینجا مقیاس ریال بزرگ
    expect(addRials(340615106959, 560135378890)).toBe(900750485849n);
    expect(subRials(900750485849n, 560135378890)).toBe(340615106959n);
    expect(mulRial(1234567, 3)).toBe(3703701n);
  });

  it('splitRial جمع خروجی را برابر کل نگه می‌دارد', () => {
    const parts = splitRial(1000001n, 3);
    expect(parts).toEqual([333334n, 333334n, 333333n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1000001n);
    const parts2 = splitRial(99, 4);
    expect(parts2.reduce((a, b) => a + b, 0n)).toBe(99n);
  });

  it('تراز سند دوطرفه صحت‌سنجی می‌شود', () => {
    expect(isBalanced([1000n, 500], [1500])).toBe(true);
    expect(isBalanced([1000n], [1500])).toBe(false);
  });

  it('نمایش‌ها فقط نمایش‌اند (تومان مضرب ۱۰ ریال)', () => {
    expect(formatWithSeparators(1234567n)).toBe('1,234,567');
    expect(toFaDigits('1234')).toBe('۱۲۳۴');
    expect(formatRialFa(25000n)).toBe('۲۵٬۰۰۰ ریال');
    expect(rialToToman(25000n)).toBe(2500);
    expect(() => rialToToman(25005n)).toThrow(MoneyError);
  });

  it('ورودی کاربر فارسی/جداکننده را به ریال صحیح می‌برد', () => {
    expect(parseUserAmount('۱٬۲۳۴٬۵۶۷')).toBe(1234567n);
    expect(parseUserAmount('1,234,567')).toBe(1234567n);
    expect(parseUserAmount('340615106959')).toBe(340615106959n);
    expect(() => parseUserAmount('12.5')).toThrow(MoneyError);
    expect(() => parseUserAmount('abc')).toThrow(MoneyError);
  });
});
