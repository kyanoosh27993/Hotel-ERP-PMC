/**
 * integration-hub.service.ts — الگوی Adapter مستقل برای هر تجهیز/سرویس بیرونی (قواعد یکپارچگی):
 * قطع سرویس بیرونی هرگز عملیات داخلی را متوقف نمی‌کند — حالت degrade تعریف‌شده.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

export type AdapterHealth = 'healthy' | 'degraded' | 'disconnected';

export interface IntegrationAdapter {
  /** شناسه پایدار ادپتور (مثل attendance-sim) */
  readonly id: string;
  readonly labelEn: string;
  readonly labelFa: string;
  /** سلامت فعلی — هرگز throw نمی‌کند */
  health(): Promise<AdapterHealth>;
  /** آخرین خطا یا null */
  lastError(): string | null;
}

export interface AttendancePunch {
  employeeCode: string;
  at: Date;
  kind: 'IN' | 'OUT';
}

/** Adapter نمونه دستگاه حضور و غیاب (شبیه‌سازی‌شده — F1-T6) */
@Injectable()
export class AttendanceSimAdapter implements IntegrationAdapter {
  readonly id = 'attendance-sim';
  readonly labelEn = 'Attendance device (simulated)';
  readonly labelFa = 'دستگاه حضور و غیاب (شبیه‌سازی‌شده)';

  private error: string | null = null;
  private connected = true;
  private seq = 0;
  readonly generated: AttendancePunch[] = [];

  /** شبیه‌سازی قطع/وصل سرویس — برای تست degrade */
  setConnected(connected: boolean): void {
    this.connected = connected;
    this.error = connected ? null : 'simulated connection lost';
  }

  async health(): Promise<AdapterHealth> {
    return this.connected ? 'healthy' : 'degraded';
  }

  lastError(): string | null {
    return this.error;
  }

  /** تولید رویداد زدن کارت (برای PoC) — در قطعی، داده محلی صف می‌شود */
  punch(employeeCode: string, kind: 'IN' | 'OUT', at = new Date()): AttendancePunch | null {
    if (!this.connected) {
      // حالت آفلاین: ذخیره محلی برای همگام‌سازی بعدی — هیچ داده‌ای از دست نمی‌رود
      this.generated.push({ employeeCode, at, kind });
      return null;
    }
    return { employeeCode, at, kind };
  }

  pullPending(): AttendancePunch[] {
    const out = [...this.generated];
    this.generated.length = 0;
    return out;
  }
}

@Injectable()
export class IntegrationHubService {
  private readonly logger = new Logger('IntegrationHub');
  private readonly adapters = new Map<string, IntegrationAdapter>();

  register(adapter: IntegrationAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.logger.log(`adapter registered: ${adapter.id}`);
  }

  list(): Array<{ id: string; labelEn: string; labelFa: string }> {
    return [...this.adapters.values()].map((a) => ({ id: a.id, labelEn: a.labelEn, labelFa: a.labelFa }));
  }

  async status(): Promise<Array<{ id: string; health: AdapterHealth; lastError: string | null }>> {
    const out = [];
    for (const a of this.adapters.values()) {
      out.push({ id: a.id, health: await a.health(), lastError: a.lastError() });
    }
    return out;
  }

  get(id: string): IntegrationAdapter {
    const a = this.adapters.get(id);
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: `Unknown adapter: ${id}` });
    return a;
  }
}
