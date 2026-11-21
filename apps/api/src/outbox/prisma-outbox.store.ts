/**
 * prisma-outbox.store.ts — نگارخانه واقعی PostgreSQL:
 * ادعای امن دسته‌ای با FOR UPDATE SKIP LOCKED (چند ناشر هم‌زمان، بدون دوباره‌خوانی).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ClaimedEvent, OutboxStoreLike } from './outbox.types';

interface RawClaimRow {
  id: string;
  event_name: string;
  aggregate: string;
  producer: string;
  version: number;
  idempotency_key: string;
  payload: unknown;
  created_at: Date;
}

@Injectable()
export class PrismaOutboxStore implements OutboxStoreLike {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(limit: number): Promise<ClaimedEvent[]> {
    const rows = await this.prisma.$queryRaw<RawClaimRow[]>`
      UPDATE outbox_events
      SET attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE published_at IS NULL AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_name, aggregate, producer, version, idempotency_key, payload, created_at
    `;
    return rows.map((r) => ({
      id: r.id,
      eventName: r.event_name,
      aggregate: r.aggregate,
      producer: r.producer,
      version: r.version,
      idempotencyKey: r.idempotency_key,
      payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }

  async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { publishedAt: new Date(), lastError: null },
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { lastError: error.slice(0, 500), nextAttemptAt },
    });
  }
}
