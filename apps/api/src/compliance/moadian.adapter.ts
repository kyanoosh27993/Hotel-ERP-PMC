/**
 * moadian.adapter.ts — فاز ۹ / F9-T2: Adapter مستقل ادغام مؤدیان (قانون یکپارچگی).
 * شبیه‌ساز سندباکس مؤدیان با قرارداد واقعی (header/body/idempotencyKey → uid + status).
 * قطع سرویس → degraded؛ داده محلی صف می‌ماند (Outbox) و گم نمی‌شود.
 *
 * وقتی MOADIAN_BASE_URL + کلید مالیاتی پیکربانی شد، MoadianLiveAdapter با همان قرارداد
 * جایگزین می‌شود (DROP-IN) — هیچ کد ماژول دیگری تغییر نمی‌کند.
 */
import { Injectable, Logger } from '@nestjs/common';

export type MoadianStatus = 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'PENDING';
export type AdapterHealth = 'healthy' | 'degraded' | 'disconnected';

export interface MoadianHeader {
  invoiceNumber: string;
  sellerTaxId: string;
  buyerTaxId: string;
  buyerName: string;
  issueDate: string; // YYYY-MM-DD
  totalRials: string;
  vatRials: string;
  discountRials: string;
}

export interface MoadianBodyLine {
  description: string;
  quantity: number;
  unitPriceRials: string;
  totalRials: string;
  vatRateBps: number;
  vatRials: string;
  revenueAccountCode: string;
}

export interface MoadianPacket {
  header: MoadianHeader;
  body: MoadianBodyLine[];
  idempotencyKey: string;
}

export interface MoadianSubmitResult {
  uid: string;
  status: MoadianStatus;
  at: string;
  raw?: unknown;
}

export interface MoadianCancelResult {
  uid: string;
  status: MoadianStatus;
  at: string;
  raw?: unknown;
}

/** Adapter مستقل — هرگز در قطعی عملیات داخلی را متوقف نمی‌کند (حالت degrade). */
export interface MoadianAdapter {
  readonly id: string;
  submit(packet: MoadianPacket): Promise<MoadianSubmitResult>;
  cancel(uid: string, reason: string, idempotencyKey: string): Promise<MoadianCancelResult>;
  status(uid: string): Promise<MoadianStatus>;
  health(): Promise<AdapterHealth>;
  lastError(): string | null;
  setConnected(connected: boolean): void;
}

@Injectable()
export class MoadianSimAdapter implements MoadianAdapter {
  readonly id = 'moadian-sim';
  private readonly logger = new Logger('MoadianSimAdapter');
  private connected = true;
  private error: string | null = null;
  /** uid یکتا و پایدار به‌ازای idempotencyKey — ارسال مجدد همان uid برمی‌گردد */
  private readonly uidByKey = new Map<string, string>();
  private readonly statusByUid = new Map<string, MoadianStatus>();
  private seq = 0;

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.error = connected ? null : 'simulated moadian sandbox unreachable';
  }

  health(): Promise<AdapterHealth> {
    return Promise.resolve(this.connected ? 'healthy' : 'degraded');
  }

  lastError(): string | null {
    return this.error;
  }

  async submit(packet: MoadianPacket): Promise<MoadianSubmitResult> {
    if (!this.connected) {
      this.error = 'simulated moadian sandbox unreachable';
      throw new Error('MOADIAN_UNREACHABLE');
    }
    // Idempotency: همان کلید → همان uid
    let uid = this.uidByKey.get(packet.idempotencyKey);
    if (!uid) {
      this.seq += 1;
      uid = `SIM-${Date.now().toString(36)}-${this.seq.toString(36).toUpperCase()}`;
      this.uidByKey.set(packet.idempotencyKey, uid);
      this.statusByUid.set(uid, 'ACCEPTED');
      this.logger.log(`submit ${packet.header.invoiceNumber} → uid=${uid} ACCEPTED`);
    } else {
      this.logger.log(`submit replay ${packet.header.invoiceNumber} → uid=${uid} (idempotent)`);
    }
    return { uid, status: 'ACCEPTED', at: new Date().toISOString() };
  }

  async cancel(uid: string, reason: string, _idempotencyKey: string): Promise<MoadianCancelResult> {
    if (!this.connected) {
      this.error = 'simulated moadian sandbox unreachable';
      throw new Error('MOADIAN_UNREACHABLE');
    }
    const cur = this.statusByUid.get(uid);
    if (cur === 'CANCELLED') {
      // لغوی دوباره → همان نتیجه (idempotent)؛ سرویس بالاتر ۴۰۹ می‌دهد برای جلوگیری از لغوی دوگانه
      return { uid, status: 'CANCELLED', at: new Date().toISOString() };
    }
    this.statusByUid.set(uid, 'CANCELLED');
    this.logger.log(`cancel uid=${uid} reason=${reason}`);
    return { uid, status: 'CANCELLED', at: new Date().toISOString() };
  }

  async status(uid: string): Promise<MoadianStatus> {
    return this.statusByUid.get(uid) ?? 'PENDING';
  }
}
