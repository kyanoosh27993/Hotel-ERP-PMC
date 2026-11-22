/**
 * wave1.spec.ts — تست واحد موج ۱ (فاز ۵/۱۰): ریاضی مغایرت شیفت، جهت تراکنش‌های خزانه،
 * محاسبهٔ قسط استهلاک خط مستقیم و مالیات خدمات جانبی.
 */
import { TreasuryService } from '../../src/treasury/treasury.service';

describe('TreasuryService.shiftFlow — ریاضی شیفت صندوق', () => {
  const svc = new TreasuryService({} as never, {} as never);
  const flow = (svc as unknown as {
    shiftFlow: (s: { openingFloatRials: bigint }, t: Array<{ kind: string; amountRials: bigint }>) => {
      inflowRials: bigint; outflowRials: bigint; expectedRials: bigint;
    };
  }).shiftFlow.bind(svc);

  it('موجودی انتظاری = ابتدای شیفت + ورودی − خروجی', () => {
    const txns = [
      { kind: 'RECEIPT', amountRials: 2_000_000n },
      { kind: 'RECEIPT', amountRials: 500_000n },
      { kind: 'PAYMENT', amountRials: 300_000n },
      { kind: 'REFUND', amountRials: 100_000n },
      { kind: 'TRANSFER', amountRials: 700_000n },
    ];
    const r = flow({ openingFloatRials: 1_000_000n }, txns as never);
    expect(r.inflowRials).toBe(3_200_000n);
    expect(r.outflowRials).toBe(400_000n);
    expect(r.expectedRials).toBe(3_800_000n);
  });

  it('شیفت بدون گردش = موجودی ابتدای شیفت', () => {
    const r = flow({ openingFloatRials: 500_000n }, []);
    expect(r.expectedRials).toBe(500_000n);
  });

  it('اصلاح جهت ورود است و در مغایرت به نفع صندوق می‌شمارد', () => {
    const r = flow({ openingFloatRials: 0n }, [{ kind: 'ADJUSTMENT', amountRials: 250_000n }] as never);
    expect(r.expectedRials).toBe(250_000n);
  });

  it('مغایرت شمارش نهایی با ورودی/خروجی', () => {
    const txns = [
      { kind: 'RECEIPT', amountRials: 2_000_000n },
      { kind: 'PAYMENT', amountRials: 300_000n },
    ];
    const r = flow({ openingFloatRials: 500_000n }, txns as never);
    const counted = 2_250_000n;
    expect(counted - r.expectedRials).toBe(50_000n); // کسری ۵۰٬۰۰۰
  });
});

describe('استهلاک خط مستقیم — قاعدهٔ قسط ماهانه', () => {
  const monthly = (cost: bigint, salvage: bigint, lifeMonths: number): bigint =>
    (cost - salvage) / BigInt(lifeMonths);

  it('قسط = (بها − اسقاط) ÷ عمر مفید', () => {
    expect(monthly(24_000_000n, 0n, 24)).toBe(1_000_000n);
    expect(monthly(10_000_000n, 1_000_000n, 18)).toBe(500_000n);
  });

  it('کسر به پایین صحیح برای ارقام غیرقابل تقسیم', () => {
    expect(monthly(10_000_000n, 0n, 3)).toBe(3_333_333n);
  });

  it('سقف استهلاک تا رسیدن به ارزش اسقاط (دورهٔ آخر)', () => {
    const cost = 10_000_000n, salvage = 1_000_000n, life = 3;
    const m = (cost - salvage) / BigInt(life);
    let accumulated = 0n;
    for (let i = 0; i < life - 1; i += 1) accumulated += m;
    const remaining = cost - salvage - accumulated;
    const last = m < remaining ? m : remaining;
    expect(last).toBe(remaining); // باقیمانده در دورهٔ آخر
    expect(accumulated + last).toBe(cost - salvage);
  });
});

describe('مالیات خدمات جانبی — گرد کردن basis point', () => {
  const taxOf = (net: bigint, bps: number): bigint => (net * BigInt(bps) + 5000n) / 10000n;

  it('۹٪ با گرد کردن به نزدیک‌ترین ریال', () => {
    expect(taxOf(3_000_000n, 900)).toBe(270_000n);
    expect(taxOf(1_000_000n, 900)).toBe(90_000n);
  });

  it('ارقام ریز گرد می‌شوند (به نزدیک‌ترین ریال)', () => {
    expect(taxOf(100n, 900)).toBe(9n);
    expect(taxOf(105n, 900)).toBe(9n); // 9.45 → 9 (زیر ½)
    expect(taxOf(109n, 900)).toBe(10n); // 9.81 → 10
  });
});
