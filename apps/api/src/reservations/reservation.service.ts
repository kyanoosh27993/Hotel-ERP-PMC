/**
 * reservation.service.ts — PoC رزرواسیون با کنترل ظرفیت Race-safe:
 * قفل مشورتی روی نوع اتاق (pg_advisory_xact_lock) + بررسی هم‌پوشانی بازه + ثبت اتمیک با رویداد.
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import { mulRial } from '@hotel-erp/shared';
import { nextDocSeq } from '../common/doc-seq';

export interface ConfirmInput {
  roomTypeId: string;
  guestName: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string;
  idempotencyKey: string;
  createdByUserId: string;
}

@Injectable()
export class ReservationService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  /** تعداد شب‌ها از دو تاریخ ISO — خالص و قابل تست */
  static calcNights(checkIn: string, checkOut: string): number {
    const a = new Date(`${checkIn}T00:00:00Z`).getTime();
    const b = new Date(`${checkOut}T00:00:00Z`).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) throw new ConflictException({ code: 'VALIDATION', message: 'Invalid date format (expected YYYY-MM-DD)' });
    const nights = Math.round((b - a) / 86400_000);
    if (nights < 1) throw new ConflictException({ code: 'BUSINESS_RULE', message: 'checkOutDate must be after checkInDate' });
    return nights;
  }

  async confirm(input: ConfirmInput): Promise<{ reservationId: string; code: string; replayed: boolean }> {
    const nights = ReservationService.calcNights(input.checkInDate, input.checkOutDate);

    // تکرار با همان کلید → همان رزرو (بدون اثر جانبی)
    const existing = await this.prisma.reservation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { reservationId: existing.id, code: existing.code, replayed: true };

    const roomType = await this.prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
    if (!roomType) throw new ConflictException({ code: 'NOT_FOUND', message: 'Room type not found' });
    const total = mulRial(roomType.baseRateRials, nights);

    return this.prisma.$transaction(async (tx) => {
      // قفل مشورتی روی roomTypeId — دو تراکنش هم‌زمان سری می‌شوند (Race-safe).
      // خروجی boolean تا Prisma بتواند deserialize کند (تابع اصلی void برمی‌گرداند).
      await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${input.roomTypeId})) AS l) t`;

      const overlapping = await tx.reservation.count({
        where: {
          roomTypeId: input.roomTypeId,
          status: { in: ['CONFIRMED', 'CHECKED_IN'] },
          checkIn: { lt: new Date(`${input.checkOutDate}T00:00:00Z`) },
          checkOut: { gt: new Date(`${input.checkInDate}T00:00:00Z`) },
        },
      });
      if (overlapping > 0) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Room is not available for the requested range' });
      }

      const seq = await nextDocSeq(tx, 'reservation');
      const code = `RSV-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;

      const reservation = await tx.reservation.create({
        data: {
          code,
          roomTypeId: input.roomTypeId,
          guestName: input.guestName,
          checkIn: new Date(`${input.checkInDate}T00:00:00Z`),
          checkOut: new Date(`${input.checkOutDate}T00:00:00Z`),
          nights,
          totalRials: total,
          status: 'CONFIRMED',
          idempotencyKey: input.idempotencyKey,
          createdById: input.createdByUserId === 'system:engine' ? null : input.createdByUserId,
        },
      });

      // رویداد در همان تراکنش (Transactional Outbox — بدون رویداد گم‌شده)
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.RESERVATION_CONFIRMED,
        aggregate: 'reservation',
        idempotencyKey: reservation.id,
        producer: 'booking',
        payload: {
          reservationId: reservation.id,
          roomTypeId: input.roomTypeId,
          roomId: null,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          nights,
          totalAmountRials: Number(total),
          guestName: input.guestName,
        },
      });

      return { reservationId: reservation.id, code, replayed: false };
    });
  }
}
