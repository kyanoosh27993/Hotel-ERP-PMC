/**
 * outbox.publisher.ts — حلقه ناشر: ادعای دسته، تحویل به مصرف‌کنندگان، نشانه‌گذاری انتشار.
 * شکست مصرف → backoff نمایی و تلاش مجدد؛ تحویل حداقل یک‌بار (تکرار با inbox دفع می‌شود).
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import type { OutboxStoreLike } from './outbox.types';
import { PrismaOutboxStore } from './prisma-outbox.store';

const BATCH_SIZE = 50;
const POLL_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OutboxPublisher');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: OutboxStoreLike, // PrismaOutboxStore (قابل جایگزینی در تست)
    private readonly outbox: OutboxService,
  ) {}

  static createWithDefaultStore(outbox: OutboxService, prismaStore: PrismaOutboxStore): OutboxPublisher {
    return new OutboxPublisher(prismaStore, outbox);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), POLL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishOnce();
    } catch (err) {
      this.logger.error(`publish tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** یک دور انتشار — عمومی برای تست و اجرای دستی */
  async publishOnce(): Promise<number> {
    const claimed = await this.store.claimBatch(BATCH_SIZE);
    for (const ev of claimed) {
      const envelope = {
        eventId: ev.id,
        eventName: ev.eventName as import('@hotel-erp/contracts').EventName,
        occurredAt: ev.createdAt.toISOString(),
        producer: ev.producer,
        idempotencyKey: ev.idempotencyKey,
        version: ev.version as 1,
        payload: ev.payload,
      };
      try {
        await this.outbox.dispatch(envelope);
        await this.store.markPublished(ev.id);
      } catch (err) {
        const attempt = 1; // claimBatch قبلا attempts را +1 کرده
        const delay = Math.min(MAX_BACKOFF_MS, 2 ** attempt * 1000);
        await this.store.markFailed(ev.id, (err as Error).message, new Date(Date.now() + delay));
        this.logger.warn(`event ${ev.eventName}/${ev.id} failed: ${(err as Error).message} — retry in ${delay}ms`);
      }
    }
    return claimed.length;
  }
}
