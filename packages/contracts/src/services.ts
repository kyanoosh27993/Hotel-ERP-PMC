/**
 * services.ts — درگاه‌های سرویس بین‌ماژولی (فراخوانی درون‌پردازشی نسخه‌دار).
 * هیچ ماژولی repository ماژول دیگر را مستقیم صدا نمی‌زند (قواعد معماری بخش ۳).
 */

import { ReservationConfirmedPayload, PosOrderServedPayload } from './payloads';

/** درگاه ماژول حسابداری — فقط این امضاها برای سایر ماژول‌ها دیده می‌شود */
export interface IAccountingService {
  /** ثبت سند از رویداد دامنه‌ای با قاعده نگاشت پارامتریک؛ idempotent با inboxKey */
  postEntryFromEvent(
    inboxKey: string,
    ruleId: string,
    lines: Array<{
      accountCode: string;
      debitRials: bigint;
      creditRials: bigint;
      costCenterCode?: string | null;
    }>,
    meta: {
      description: string;
      sourceModule: string;
      sourceRef: string;
      sourceEventId: string;
      createdByUserId: string; // 'system:engine' برای موتور سند خودکار
    },
  ): Promise<{ entryNo: string; id: string }>;
}

/** درگاه ماژول پذیرش/رزرو */
export interface IReservationService {
  confirm(input: {
    roomTypeId: string;
    guestName: string;
    checkInDate: string;
    checkOutDate: string;
    idempotencyKey: string;
    createdByUserId: string;
  }): Promise<{ reservationId: string }>;
}

/** درگاه ماژول POS */
export interface IPosService {
  serveOrder(input: {
    outletId: string;
    lines: Array<{ itemName: string; qty: number; unitPriceRials: number }>;
    taxRatePermille: number;
    folioId: string | null;
    idempotencyKey: string;
    servedByUserId: string;
  }): Promise<{ orderId: string; orderNo: string }>;
}

export type { ReservationConfirmedPayload, PosOrderServedPayload };
