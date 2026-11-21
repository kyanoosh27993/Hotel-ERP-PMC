/**
 * event-journal-consumer.ts — مصرف‌کننده رویدادهای دامنه‌ای → موتور سند خودکار.
 * قاعده نگاشت از جدول event_journal_rules خوانده می‌شود (پارامتریک، بدون هاردکد در کد مصرف).
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EVENT_NAMES, type EventEnvelope, type ReservationConfirmedPayload, type PosOrderServedPayload } from '@hotel-erp/contracts';
import { JournalService, SYSTEM_ENGINE_USER } from './journal.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';
import { subRials } from '@hotel-erp/shared';

interface RuleLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amountKind: 'total' | 'tax' | 'net';
}

@Injectable()
export class EventJournalConsumer implements OnModuleInit {
  private readonly logger = new Logger('EventJournalConsumer');

  constructor(
    private readonly outbox: OutboxService,
    private readonly journal: JournalService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.outbox.on(EVENT_NAMES.RESERVATION_CONFIRMED, (e) => this.handleReservationConfirmed(e));
    this.outbox.on(EVENT_NAMES.POS_ORDER_SERVED, (e) => this.handlePosOrderServed(e));
  }

  /** booking.reservation.confirmed → بدهکار حساب مهمان / بستانکار درآمد اتاق */
  private async handleReservationConfirmed(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as ReservationConfirmedPayload;
    const rule = await this.loadRule(EVENT_NAMES.RESERVATION_CONFIRMED);
    if (!rule) return;

    const total = BigInt(payload.totalAmountRials);
    const lines = rule.map((l) => ({
      accountCode: l.accountCode,
      debitRials: l.side === 'debit' ? total : 0n,
      creditRials: l.side === 'credit' ? total : 0n,
    }));

    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: reservation ${payload.reservationId} (${payload.nights} nights)`,
        sourceModule: 'booking',
        sourceRef: payload.reservationId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for reservation ${payload.reservationId}`);
  }

  /** pos.order.served → بدهکار صندوق / بستانکار درآمد + بستانکار مالیات ارزش افزوده */
  private async handlePosOrderServed(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as PosOrderServedPayload;
    const rule = await this.loadRule(EVENT_NAMES.POS_ORDER_SERVED);
    if (!rule) return;

    const total = BigInt(payload.totalAmountRials);
    const tax = BigInt(payload.taxAmountRials);
    const net = subRials(total, tax);
    const amountFor = (kind: RuleLine['amountKind']): bigint =>
      kind === 'total' ? total : kind === 'tax' ? tax : net;

    const lines = rule.map((l) => ({
      accountCode: l.accountCode,
      debitRials: l.side === 'debit' ? amountFor(l.amountKind) : 0n,
      creditRials: l.side === 'credit' ? amountFor(l.amountKind) : 0n,
    }));

    await this.journal.postEntryFromEvent(
      envelope.idempotencyKey,
      lines,
      {
        description: `Auto: POS order ${payload.orderNo}`,
        sourceModule: 'pos',
        sourceRef: payload.orderId,
        sourceEventId: envelope.eventId,
        createdByUserId: SYSTEM_ENGINE_USER,
      },
    );
    this.logger.log(`journal posted for POS order ${payload.orderNo}`);
  }

  private async loadRule(eventName: string): Promise<RuleLine[] | null> {
    const row = await this.prisma.eventJournalRule.findUnique({ where: { eventName } });
    if (!row || !row.isActive) {
      this.logger.warn(`no active journal rule for ${eventName} — event left without entry`);
      return null;
    }
    return (typeof row.linesJson === 'string' ? JSON.parse(row.linesJson) : row.linesJson) as RuleLine[];
  }
}
