import {
  toJalaali, toGregorian, isLeapJalaali, jalaaliMonthLength, isValidJalaali,
  formatJalaali, parseJalaali, jalaaliFromDate, jalaaliDayOfWeek, jalaaliToIso,
} from '../src/jalali';

describe('jalali — تقویم شمسی (تأییدشده v0.1)', () => {
  it('کبیسه ۱۴۰۳ → ۳۰ اسفند و سال بعد ۱ فروردین', () => {
    expect(isLeapJalaali(1403)).toBe(true);
    expect(jalaaliMonthLength(1403, 12)).toBe(30);
    expect(isValidJalaali(1403, 12, 30)).toBe(true);
    const g = toGregorian(1403, 12, 30);
    const next = toJalaali(g.gy, g.gm, g.gd + 1);
    expect(next).toEqual({ jy: 1404, jm: 1, jd: 1 });
  });

  it('سال عادی ۱۴۰۵ اسفند ۲۹ روز دارد', () => {
    expect(isLeapJalaali(1405)).toBe(false);
    expect(jalaaliMonthLength(1405, 12)).toBe(29);
    expect(isValidJalaali(1405, 12, 30)).toBe(false);
  });

  it('تبدیل رفت‌وبرگشت میلادی↔شمسی پایدار است', () => {
    // آغاز نوروز ۱۴۰۴ = ۲۱ مارس ۲۰۲۵
    expect(toJalaali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(toGregorian(1404, 1, 1)).toEqual({ gy: 2025, gm: 3, gd: 21 });
    // مهر ۱۴۰۵ از ۲۳ سپتامبر ۲۰۲۶ آغاز می‌شود (اعتدال پاییز)
    expect(toJalaali(2026, 9, 22)).toEqual({ jy: 1405, jm: 6, jd: 31 });
    expect(toJalaali(2026, 9, 23)).toEqual({ jy: 1405, jm: 7, jd: 1 });
    expect(toGregorian(1405, 7, 1)).toEqual({ gy: 2026, gm: 9, gd: 23 });
  });

  it('فرمت و پارس استاندارد YYYY/MM/DD', () => {
    expect(formatJalaali(1405, 9, 1)).toBe('1405/09/01');
    expect(parseJalaali('1405/09/01')).toEqual({ jy: 1405, jm: 9, jd: 1 });
    expect(parseJalaali('1403/12/30')).not.toBeNull();
    expect(parseJalaali('1405/12/30')).toBeNull();
    expect(parseJalaali('garbage')).toBeNull();
  });

  it('jalaaliFromDate و ISO و روز هفته', () => {
    expect(jalaaliFromDate(new Date(2025, 2, 21))).toBe('1404/01/01');
    expect(jalaaliDayOfWeek(1404, 1, 1)).toBe(6); // نوروز ۱۴۰۴ جمعه
    const iso = jalaaliToIso('1404/01/01');
    expect(iso).toContain('2025-03-2');
  });

  it('پیمایش روزبه‌روز یک سال کامل از مرزها عبور نمی‌کند', () => {
    let j = { jy: 1403, jm: 12, jd: 25 } as { jy: number; jm: number; jd: number };
    for (let i = 0; i < 10; i += 1) {
      const g = toGregorian(j.jy, j.jm, j.jd);
      j = toJalaali(g.gy, g.gm, g.gd + 1);
    }
    expect(j).toEqual({ jy: 1404, jm: 1, jd: 5 });
  });
});
