/** payloadهای رویدادها — نسخه ۱ قرارداد */

export interface StayCheckedOutPayload {
  stayId: string;
  code: string;
  roomCodes: string[];
  nights: number;
  /** فولیو نهایی اقامت (شب‌ها + خدمات) برای سند تسویه */
  folioRials: number;
  guestName: string;
}

export interface ReservationCancelledPayload {
  reservationId: string;
  guestName: string;
  nights: number;
  /** مبلغ کل رزرو لغوشده برای سند معکوس */
  totalAmountRials: number;
}

export interface ReservationConfirmedPayload {
  reservationId: string;
  roomTypeId: string;
  roomId: string | null;
  checkInDate: string; // ISO date
  checkOutDate: string;
  nights: number;
  /** مبلغ کل رزرو به ریال صحیح */
  totalAmountRials: number;
  guestName: string;
}

export interface PosOrderServedPayload {
  orderId: string;
  outletId: string;
  orderNo: string;
  /** جمع فروش به ریال صحیح */
  totalAmountRials: number;
  /** مالیات به ریال صحیح */
  taxAmountRials: number;
  lines: Array<{ itemName: string; qty: number; unitPriceRials: number; lineTotalRials: number }>;
  /** پیوند به مهمان در صورت شارژ اتاق */
  folioId: string | null;
}

export interface NightAuditPostedPayload {
  /** شب مورد شارژ (YYYY-MM-DD) */
  businessDate: string;
  /** جمع شارژ شب (ریال) — بدهکار ۱۲۰۱ */
  chargedRials: number;
  stays: Array<{ stayCode: string; roomCode: string; rateRials: number }>;
}

export interface PayrollRunApprovedPayload {
  runId: string;
  periodCode: string; // '1405-09'
  /** جمع ناخالص حقوق و دستمزد (ریال) */
  grossRials: number;
  /** حق بیمه سهم کارگر ۷٪ (ریال) */
  insEmployeeRials: number;
  /** حق بیمه سهم کارفرما ۲۳٪ (ریال) */
  insEmployerRials: number;
  /** مالیات حقوق دوره (ریال) */
  taxRials: number;
  /** خالص پرداختی (ریال) */
  netRials: number;
  /** تعداد فیش‌ها */
  employeeCount: number;
  /** نسخه پارامترهای قانونی استفاده‌شده */
  paramsVersion: string;
}

// ───────────────────────── موج ۱ — فاز ۵ (خزانه‌داری) ─────────────────────────

export interface TreasuryTransactionPostedPayload {
  txnId: string;
  /** شمارهٔ تراکنش TXN-<jy>-<seq> */
  txnNo: string;
  /** RECEIPT | PAYMENT | TRANSFER | REFUND | ADJUSTMENT */
  kind: string;
  /** CASH | CARD | TRANSFER | ONLINE */
  method: string;
  /** مبلغ به ریال صحیح (همیشه مثبت؛ جهت با kind تعیین می‌شود) */
  amountRials: number;
  /** کد صندوق/حساب بانکی (CH-01، BN-01…) */
  cashAccountCode: string;
  /** کد حساب کل متصل به صندوق (۱۱۰۱ صندوق، ۱۱۰۲ بانک) */
  cashGlAccountCode: string;
  /** شمارهٔ پیگیری بانکی/درگاهی */
  traceNo: string | null;
  /** پیوند اقامت در صورت شارژ اتاق */
  stayCode: string | null;
  /** تاریخ عملیاتی YYYY-MM-DD */
  businessDate: string;
}

// ───────────────────────── موج ۱ — فاز ۱۰ (خانه‌داری، دارایی، خدمات جانبی) ─────────────────────────

export interface HousekeepingTaskCompletedPayload {
  taskId: string;
  roomCode: string;
  /** CLEANING | INSPECTION | TURNDOWN | MAINTENANCE_FOLLOWUP */
  kind: string;
  assigneeUsername: string | null;
  completedAt: string;
}

export interface MaintenanceRequestCreatedPayload {
  requestId: string;
  requestNo: string;
  roomCode: string | null;
  assetCode: string | null;
  title: string;
  /** LOW | NORMAL | HIGH | URGENT */
  priority: string;
}

export interface AssetDepreciationPostedPayload {
  assetId: string;
  assetCode: string;
  /** دورهٔ شمسی '1405-09' */
  periodCode: string;
  /** قسط استهلاک دوره (ریال) */
  depreciationRials: number;
  /** استهلاک انباشته تا این دوره (ریال) */
  accumulatedRials: number;
}

export interface AncillaryOrderConfirmedPayload {
  orderId: string;
  orderNo: string;
  /** PHONE | PARKING | TAXI | POOL | INTERNET | SHOP | CEREMONY | OTHER */
  category: string;
  quantity: number;
  /** جمع خالص (بدون مالیات) به ریال */
  netRials: number;
  /** مالیات بر ارزش افزوده ۹٪ (ریال) */
  taxRials: number;
  /** جمع کل شارژ (ریال) */
  totalRials: number;
  /** پیوند اقامت در صورت شارژ اتاق */
  stayCode: string | null;
}

// ───────────────────────── موج ۲ — فاز ۶ (رستوران) ─────────────────────────

export interface RestaurantOrderServedPayload {
  orderId: string;
  orderNo: string;
  outletCode: string;
  /** DINE_IN | TAKEAWAY | ROOM_SERVICE */
  mode: string;
  /** پیوند اقامت در روم‌سرویس */
  stayCode: string | null;
  lines: Array<{
    orderItemId: string;
    menuItemCode: string;
    /** null = سیاست مصرف مشخص (مصرف انبار نمی‌شود) */
    recipeCode: string | null;
    qty: number;
  }>;
}

export interface KitchenTicketCreatedPayload {
  ticketId: string;
  ticketNo: string;
  orderId: string;
  orderNo: string;
  tableLabel: string | null;
  items: Array<{ name: string; qty: number; note: string | null }>;
}

// ───────────────────────── موج ۲ — فاز ۷ (خرید/انبار/کاست کنترل) ─────────────────────────

export interface PurchaseOrderApprovedPayload {
  poId: string;
  poNo: string;
  supplierCode: string;
  /** جمع کل PO به ریال */
  totalRials: number;
  lines: Array<{ stockItemCode: string; qty: number; unitCostRials: number }>;
}

export interface GrnReceivedPayload {
  grnId: string;
  grnNo: string;
  poNo: string;
  supplierCode: string;
  /** حساب ledger تأمین‌کننده (پیش‌فرض ۲۱۰۱) */
  supplierLedgerCode: string;
  /** جمع خالص کالا (ریال) — بدهکار ۱۳۰۱ */
  netRials: number;
  /** مالیات خرید (ریال) — بدهکار ۲۲۰۴ */
  taxRials: number;
  /** جمع بدهی به تأمین‌کننده (ریال) */
  totalRials: number;
  lines: Array<{ stockItemCode: string; qty: number; unitCostRials: number }>;
}

export interface InventoryAdjustmentPostedPayload {
  countId: string;
  countNo: string;
  warehouseCode: string;
  /** ارزش کسری (ریال) — بدهکار ۵۱۰۴ */
  lossRials: number;
  /** ارزش اضافه (ریال) — بستانکار ۵۱۰۴ */
  gainRials: number;
}

export interface InventoryConsumptionPostedPayload {
  orderId: string;
  orderNo: string;
  /** جمع ارزش مصرف به بهای میانگین (ریال) — بدهکار ۵۱۰۱ */
  consumedRials: number;
  lines: Array<{
    stockItemCode: string;
    qty: number;
    unitCostRials: number;
    valueRials: number;
  }>;
}
