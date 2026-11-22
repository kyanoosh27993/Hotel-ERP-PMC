/** payloadهای رویدادها — نسخه ۱ قرارداد */

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
