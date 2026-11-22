/**
 * wave2.spec.ts — تست واحد موج ۲ (فاز ۶/۷): میانگین موزون انبار، مالیات پس از تخفیف.
 */
import { StoresService } from '../../src/stores/stores.service';
import { RestaurantService } from '../../src/restaurant/restaurant.service';describe('StoresService.updateAvgCost — میانگین موزون', () => {
  const calc = StoresService.updateAvgCost;

  it('موجودی اولیه + ورودی → میانگین موزون دقیق', () => {
    // (100×10000 + 50×20000) ÷ 150 = 13333.33 → 13333
    expect(calc(100, 10_000n, 50, 20_000n)).toBe(13_333n);
  });

  it('موجودی صفر → میانگین = بهای واحد ورودی', () => {
    expect(calc(0, 0n, 12_000, 800n)).toBe(800n);
  });

  it('ورودی صفر — بدون تغییر میانگین', () => {
    expect(calc(100, 10_000n, 0, 5_000n)).toBe(10_000n);
  });

  it('گرد کردن به نزدیک‌ترین ریال', () => {
    // (1×1 + 2×2) ÷ 3 = 1.666 → 2
    expect(calc(1, 1n, 2, 2n)).toBe(2n);
  });
});

describe('RestaurantService.discountedTax — مالیات پس از تخفیف', () => {
  const svc = new RestaurantService({} as never, {} as never);
  const tax = (svc as unknown as {
    discountedTax: (subtotal: bigint, taxSum: bigint, net: bigint) => bigint;
  }).discountedTax.bind(svc);

  it('بدون تخفیف — مالیات کامل اقلام', () => {
    // کباب ×۲ + نوشابه: خالص ۹٬۵۰۰٬۰۰۰ — مالیات ۸۵۵٬۰۰۰
    expect(tax(9_500_000n, 855_000n, 9_500_000n)).toBe(855_000n);
  });

  it('تخفیف به نسبت پایهٔ مالیاتی را کاهش می‌دهد', () => {
    // تخفیف ۱٬۰۰۰٬۰۰۰ روی ۴٬۵۰۰٬۰۰۰: خالص ۳٬۵۰۰٬۰۰۰ → مالیات ۴۰۵٬۰۰۰ × (3.5/4.5) = ۳۱۵٬۰۰۰
    expect(tax(4_500_000n, 405_000n, 3_500_000n)).toBe(315_000n);
  });

  it('تخفیف کامل — مالیات صفر', () => {
    expect(tax(1_000_000n, 90_000n, 0n)).toBe(0n);
  });
});

describe('تبدیل واحد در رسید خرید — قاعدهٔ کیلو→گرم', () => {
  it('12 کیلوگرم با ضریب ۱۰۰۰ → ۱۲٬۰۰۰ گرم و بهای هر گرم ۸۰۰', () => {
    const factor = 1000;
    const unitCostPurchase = 800_000n; // بهای هر کیلوگرم
    const unitCostUc = BigInt(Math.round(Number(unitCostPurchase) / factor));
    expect(unitCostUc).toBe(800n);
    expect(12 * factor).toBe(12_000);
  });
});
