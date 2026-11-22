/**
 * events.ts — نام‌گذاری رویدادهای دامنه‌ای: <context>.<entity>.<action>
 * این فایل قرارداد نسخه‌دار است؛ تغییر شکستن = نسخه جدید (سند ۰۵).
 */

export const EVENT_NAMES = {
  /** رزرو تأیید شد (پس از کنترل ظرفیت در تراکنش) */
  RESERVATION_CONFIRMED: 'booking.reservation.confirmed',
  /** سفارش رستوران نهایی و تحویل شد */
  POS_ORDER_SERVED: 'pos.order.served',
  /** گردش انبار ثبت شد */
  GOODS_ISSUED: 'inventory.goods.issued',
  /** دوره حقوق تأیید شد */
  PAYROLL_RUN_APPROVED: 'payroll.run.approved',
  /** سند حسابداری ثبت شد */
  JOURNAL_ENTRY_POSTED: 'accounting.journal_entry.posted',
  /** فاز ۴ — مهمان پذیرش شد (ورود) */
  STAY_CHECKED_IN: 'pms.stay.checked_in',
  /** فاز ۴ — مهمان تسویه و خارج شد */
  STAY_CHECKED_OUT: 'pms.stay.checked_out',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

/** پاکت استاندارد رویداد (سند ۰۵ بخش ۳) */
export interface EventEnvelope<T = Record<string, unknown>> {
  /** شناسه یکتای رویداد */
  eventId: string;
  /** نام قراردادی رویداد */
  eventName: EventName;
  /** زمان وقوع (ISO-8601 UTC) */
  occurredAt: string;
  /** ماژول تولیدکننده */
  producer: string;
  /** کلید تکرارناپذیری — مصرف تکراری ممنوع */
  idempotencyKey: string;
  /** نسخه قرارداد payload */
  version: 1;
  payload: T;
}
