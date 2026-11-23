/**
 * events.ts — نام‌گذاری رویدادهای دامنه‌ای: <context>.<entity>.<action>
 * این فایل قرارداد نسخه‌دار است؛ تغییر شکستن = نسخه جدید (سند ۰۵).
 */

export const EVENT_NAMES = {
  /** رزرو تأیید شد (پس از کنترل ظرفیت در تراکنش) */
  RESERVATION_CONFIRMED: 'booking.reservation.confirmed',
  /** رزرو لغو شد (فقط در وضعیت CONFIRMED) → سند معکوس بدهی مهمان */
  RESERVATION_CANCELLED: 'booking.reservation.cancelled',
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
  /** حسابرسی شبانه — بهای اتاق شب به فولیو اقامت‌های باز شارژ شد (پولی) */
  NIGHT_AUDIT_POSTED: 'pms.night_audit.posted',
  // ── موج ۱ — فاز ۵ (صندوق، پرداخت و خزانه‌داری) ──
  /** تراکنش خزانه (دریافت/پرداخت/انتقال/برگشت/اصلاح) قطعی شد */
  TREASURY_TRANSACTION_POSTED: 'treasury.transaction.posted',
  // ── موج ۱ — فاز ۱۰ (خانه‌داری، تعمیرات، دارایی، خدمات جانبی) ──
  /** وظیفهٔ خانه‌داری انجام شد */
  HOUSEKEEPING_TASK_COMPLETED: 'housekeeping.task.completed',
  /** درخواست تعمیر ثبت شد */
  MAINTENANCE_REQUEST_CREATED: 'maintenance.request.created',
  /** سند استهلاک دارایی ثابت دوره ثبت شد */
  ASSET_DEPRECIATION_POSTED: 'assets.depreciation.posted',
  /** سفارش خدمت جانبی تأیید و شارژ شد */
  ANCILLARY_ORDER_CONFIRMED: 'ancillary.order.confirmed',
  // ── موج ۲ — فاز ۶ (رستوران، POS و آشپزخانه) ──
  /** سفارش رستوران سرو شد — زنجیرهٔ مصرف انبار (غیرپولی) */
  RESTAURANT_ORDER_SERVED: 'restaurant.order.served',
  /** بلیت آشپزخانه ایجاد شد (غیرپولی — تغذیهٔ KDS/گزارش) */
  KITCHEN_TICKET_CREATED: 'restaurant.kitchen_ticket.created',
  // ── موج ۲ — فاز ۷ (خرید، انبار و کاست کنترل) ──
  /** سفارش خرید تأیید شد (غیرپولی — تعهد خرید) */
  PURCHASE_ORDER_APPROVED: 'procurement.po.approved',
  /** رسید خرید قطعی شد — بدهی تأمین‌کننده + موجودی (پولی) */
  GRN_RECEIVED: 'procurement.grn.received',
  /** اصلاح موجودی انبارگردانی قطعی شد (پولی) */
  INVENTORY_ADJUSTMENT_POSTED: 'inventory.adjustment.posted',
  /** مصرف مواد به بهای میانگین قطعی شد — COGS (پولی) */
  INVENTORY_CONSUMPTION_POSTED: 'inventory.consumption.posted',
  // ── موج ۳ — فاز ۹ (F9-T2): ادغام مؤدیان — صورتحساب الکترونیکی ──
  /** صورتحساب از سند فروش تولید و در صف ارسال مؤدیان قرار گرفت (غیرپولی — صف ارسال) */
  INVOICE_QUEUED: 'compliance.invoice.queued',
  /** صورتحساب توسط سندباکس مؤدیان پذیرفته شد (uid برگشت) */
  INVOICE_ACCEPTED: 'compliance.invoice.accepted',
  /** صورتحساب لغو/استورنو شد (پاکت جداگانه) */
  INVOICE_CANCELLED: 'compliance.invoice.cancelled',
  // ── موج ۳ — فاز ۸ (F8-T6): موتور گردش کار تأیید چندمرحله‌ای ──
  /** نمونهٔ گردش کار همهٔ مراحلش تأیید شد (غیرپولی — ماژول‌ها مصرف‌کنندهٔ خود را ثبت می‌کنند) */
  WORKFLOW_COMPLETED: 'workflow.completed',
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
