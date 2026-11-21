/**
 * outbox.types.ts — قرارداد نگارخانه Outbox: حداقل یک‌بار تحویل + مصرف تکرارپذیر.
 */
import type { EventName } from '@hotel-erp/contracts';
import type { EventEnvelope } from '@hotel-erp/contracts';

export interface ClaimedEvent {
  id: string;
  eventName: string;
  aggregate: string;
  producer: string;
  version: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** نگارخانه Outbox — Prisma در اجرا، InMemory در تست واحد */
export interface OutboxStoreLike {
  /** ادعای دسته‌ای رویدادهای انتشارنشده (امن در هم‌زمانی: FOR UPDATE SKIP LOCKED) */
  claimBatch(limit: number): Promise<ClaimedEvent[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void>;
}

export type EventHandler = (envelope: EventEnvelope) => Promise<void>;

export { EventName, EventEnvelope };
