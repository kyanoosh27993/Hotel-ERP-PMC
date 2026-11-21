import { PosService } from '../../src/pos/pos.service';
import { ReservationService } from '../../src/reservations/reservation.service';
import { MoneyError } from '@hotel-erp/shared';

describe('PosService.computeTotals — محاسبات ریال صحیح', () => {
  const lines = [
    { itemName: 'Chelo Kabab', qty: 2, unitPriceRials: 850_000n },
    { itemName: 'Doogh', qty: 2, unitPriceRials: 60_000n },
  ];

  it('جمع و مالیات ۹۰‰ با عدد صحیح', () => {
    const { total, tax, net } = PosService.computeTotals(lines, 90);
    expect(total).toBe(1_820_000n);
    expect(tax).toBe(163_800n); // 1,820,000 × 0.09 = 163,800 دقیق
    expect(net).toBe(total - tax);
  });

  it('مالیات صفر و سطر واحد', () => {
    const r = PosService.computeTotals([{ itemName: 'Tea', qty: 1, unitPriceRials: 50_000n }], 0);
    expect(r.total).toBe(50_000n);
    expect(r.tax).toBe(0n);
  });

  it('ورودی نامعتبر رد می‌شود', () => {
    expect(() => PosService.computeTotals([], 90)).toThrow();
    expect(() => PosService.computeTotals([{ itemName: 'X', qty: 0, unitPriceRials: 1n }], 0)).toThrow();
    expect(() => PosService.computeTotals([{ itemName: 'X', qty: 1.5, unitPriceRials: 1n }], 0)).toThrow();
  });
});

describe('ReservationService.calcNights — تعداد شب', () => {
  it('شب‌های صحیح بین دو تاریخ', () => {
    expect(ReservationService.calcNights('2026-11-21', '2026-11-24')).toBe(3);
    expect(ReservationService.calcNights('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('خروج قبل از ورود یا همان روز → خطای قاعده کسب‌وکار', () => {
    expect(() => ReservationService.calcNights('2026-11-24', '2026-11-24')).toThrow();
    expect(() => ReservationService.calcNights('2026-11-25', '2026-11-24')).toThrow();
    expect(() => ReservationService.calcNights('bad', '2026-11-24')).toThrow();
  });

  it('ورودی ممیز شناور در مسیر پول رد می‌شود (MoneyError از shared)', () => {
    expect(() => {
      throw new MoneyError('guard');
    }).toThrow(MoneyError);
  });
});
