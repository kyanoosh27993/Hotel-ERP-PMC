/**
 * outbox.service.ts — ثبت رویداد در همان تراکنش دامنه (Transactional Outbox)
 * و ثبت‌نام مصرف‌کنندگان. هیچ ماژولی رویداد را مستقیم منتشر نمی‌کند.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { EventName } from '@hotel-erp/contracts';
import { randomUUID } from 'node:crypto';
import type { EventHandler } from './outbox.types';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger('Outbox');
  private readonly handlers = new Map<string, EventHandler[]>();

  /**
   * درج رویداد در Outbox **درون همان تراکنش دامنه** — تضمین اتمی بودن عملیات و رویداد.
   * @param tx کلاینت تراکنش Prisma
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      eventName: EventName;
      aggregate: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
      producer: string;
    },
  ): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: {
        eventName: input.eventName,
        aggregate: input.aggregate,
        producer: input.producer,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload as Prisma.InputJsonValue,
        version: 1,
      },
    });
    return row.id;
  }

  /** ثبت‌نام مصرف‌کننده برای رویداد — مصرف باید تکرارپذیر باشد (inbox با کلید رویداد) */
  on(eventName: EventName, handler: EventHandler): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  dispatch(envelope: import('@hotel-erp/contracts').EventEnvelope): Promise<void> {
    const handlers = this.handlers.get(envelope.eventName) ?? [];
    if (handlers.length === 0) {
      this.logger.warn(`No handler for ${envelope.eventName} (${envelope.eventId}) — marked delivered`);
      return Promise.resolve();
    }
    return (async () => {
      for (const h of handlers) await h(envelope);
    })();
  }

  /** کلید تکرارناپذیری استاندارد (تولید سمت فراخوان برای کنترل رفتار تکرار) */
  static newKey(prefix: string): string {
    return `${prefix}:${randomUUID()}`;
  }
}
