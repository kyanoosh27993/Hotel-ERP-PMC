/**
 * reservation.service.ts — فاز ۴ (F4-T2/T3): رزرو تلفنی/حضوری/گروهی با ظرفیت واقعی اتاق‌ها،
 * لیست انتظار، نرخ و تعرفه ویژه، و پذیرش (چک‌این با تخصیص اتاق / چک‌اوت).
 * Race-safe: قفل مشورتی روی نوع اتاق + جمع واحدهای هم‌پوشان در برابر ظرفیت (بدون Overbooking).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import { mulRial } from '@hotel-erp/shared';

export const RESERVATION_SOURCES = ['PHONE', 'WALK_IN', 'ONLINE', 'OTA'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export interface ConfirmInput {
  roomTypeId: string;
  guestName: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string;
  idempotencyKey: string;
  createdByUserId: string;
  units?: number; // رزرو گروهی — پیش‌فرض ۱
  source?: ReservationSource;
  ratePerNightRials?: string; // تعرفه ویژه (ریال) — خالی = نرخ پایه نوع اتاق
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

  /** ظرفیت واقعی نوع اتاق = اتاق‌های خارج از سرویس‌نشده (تعمیرات لحظه‌ای ظرفیت را کم می‌کند) */
  private async capacityOf(tx: Pick<PrismaService, 'room'>, roomTypeId: string): Promise<number> {
    return tx.room.count({ where: { roomTypeId, status: { not: 'OUT_OF_SERVICE' } } });
  }

  async confirm(input: ConfirmInput): Promise<{ reservationId: string; code: string; replayed: boolean }> {
    const nights = ReservationService.calcNights(input.checkInDate, input.checkOutDate);
    const units = input.units ?? 1;
    if (units < 1 || units > 20) throw new ConflictException({ code: 'VALIDATION', message: 'units must be 1..20' });
    const source = input.source ?? 'PHONE';

    // تکرار با همان کلید → همان رزرو (بدون اثر جانبی)
    const existing = await this.prisma.reservation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { reservationId: existing.id, code: existing.code, replayed: true };

    const roomType = await this.prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
    if (!roomType) throw new ConflictException({ code: 'NOT_FOUND', message: 'Room type not found' });

    let ratePerNight = roomType.baseRateRials;
    if (input.ratePerNightRials !== undefined) {
      const custom = BigInt(input.ratePerNightRials);
      if (custom <= 0n) throw new ConflictException({ code: 'VALIDATION', message: 'ratePerNightRials must be positive' });
      ratePerNight = custom;
    }
    const total = mulRial(ratePerNight, nights * units);

    return this.prisma.$transaction(async (tx) => {
      // قفل مشورتی روی roomTypeId — دو تراکنش هم‌زمان سری می‌شوند (Race-safe).
      await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${input.roomTypeId})) AS l) t`;

      // ظرفیت واقعی + جمع واحدهای رزروهای هم‌پوشان → بدون Overbooking حتی در رزرو گروهی
      const capacity = await this.capacityOf(tx, input.roomTypeId);
      const overlapAgg = await tx.reservation.aggregate({
        where: {
          roomTypeId: input.roomTypeId,
          status: { in: ['CONFIRMED', 'CHECKED_IN'] },
          checkIn: { lt: new Date(`${input.checkOutDate}T00:00:00Z`) },
          checkOut: { gt: new Date(`${input.checkInDate}T00:00:00Z`) },
        },
        _sum: { units: true },
      });
      const overlappingUnits = overlapAgg._sum.units ?? 0;
      if (overlappingUnits + units > capacity) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Room is not available for the requested range' });
      }

      const seq = (await tx.reservation.count()) + 1;
      const code = `RSV-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;

      const reservation = await tx.reservation.create({
        data: {
          code,
          roomTypeId: input.roomTypeId,
          guestName: input.guestName,
          checkIn: new Date(`${input.checkInDate}T00:00:00Z`),
          checkOut: new Date(`${input.checkOutDate}T00:00:00Z`),
          nights,
          units,
          source,
          ratePerNightRials: input.ratePerNightRials !== undefined ? BigInt(input.ratePerNightRials) : null,
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
          units,
          totalAmountRials: Number(total),
          guestName: input.guestName,
        },
      });

      return { reservationId: reservation.id, code, replayed: false };
    });
  }

  /** F4-T3 — چک‌این: تخصیص خودکار اتاق آزاد از همان نوع + اشغال اتاق (لحظه‌ای) */
  async checkIn(reservationId: string, userId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reservation not found' });
      if (reservation.status !== 'CONFIRMED') {
        throw new ConflictException({ code: 'BUSINESS_RULE', message: `چک‌این فقط برای رزرو CONFIRMED است (وضعیت فعلی: ${reservation.status})` });
      }

      const candidates = await tx.room.findMany({
        where: { roomTypeId: reservation.roomTypeId, status: 'AVAILABLE' },
        orderBy: [{ floor: 'asc' }, { code: 'asc' }],
        take: reservation.units,
      });
      if (candidates.length < reservation.units) {
        throw new ConflictException({ code: 'CONFLICT', message: 'اتاق آماده با این نوع موجود نیست — با خانه‌داری هماهنگ کنید' });
      }

      const now = new Date();
      const roomIds = candidates.map((r) => r.id);
      await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status: 'OCCUPIED' } });
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CHECKED_IN', roomId: roomIds[0], checkedInAt: now },
      });
      await tx.auditLog.create({
        data: { userId, action: 'CHECKED_IN', entity: 'Reservation', entityId: updated.id, afterJson: { rooms: roomIds } },
      });
      return { reservationId: updated.id, code: updated.code, status: updated.status, assignedRooms: candidates.map((r) => r.code) };
    });
  }

  /** F4-T3 — چک‌اوت: آزادسازی اتاق به وضعیت DIRTY (نظافت) */
  async checkOut(reservationId: string, userId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reservation not found' });
      if (reservation.status !== 'CHECKED_IN') {
        throw new ConflictException({ code: 'BUSINESS_RULE', message: `چک‌اوت فقط برای رزرو CHECKED_IN است (وضعیت فعلی: ${reservation.status})` });
      }
      const now = new Date();
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CHECKED_OUT', checkedOutAt: now },
      });
      if (reservation.roomId) {
        await tx.room.update({ where: { id: reservation.roomId }, data: { status: 'DIRTY' } });
      }
      await tx.auditLog.create({
        data: { userId, action: 'CHECKED_OUT', entity: 'Reservation', entityId: updated.id },
      });
      return { reservationId: updated.id, code: updated.code, status: updated.status, roomStatus: 'DIRTY' };
    });
  }

  /** F4-T2 — لیست انتظار: ثبت درخواست ظرفیت پر */
  async waitlistAdd(input: {
    guestName: string;
    phone?: string;
    roomTypeId: string;
    fromDate: string;
    toDate: string;
    units?: number;
    note?: string;
  }) {
    ReservationService.calcNights(input.fromDate, input.toDate);
    const roomType = await this.prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
    if (!roomType) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room type not found' });
    const entry = await this.prisma.waitlistEntry.create({
      data: {
        guestName: input.guestName,
        phone: input.phone ?? null,
        roomTypeId: input.roomTypeId,
        fromDate: new Date(`${input.fromDate}T00:00:00Z`),
        toDate: new Date(`${input.toDate}T00:00:00Z`),
        units: input.units ?? 1,
        note: input.note ?? null,
      },
    });
    return { id: entry.id, guestName: entry.guestName, status: entry.status };
  }

  async waitlistList() {
    const rows = await this.prisma.waitlistEntry.findMany({
      orderBy: { createdAt: 'asc' },
      include: { roomType: { select: { code: true, nameFa: true } } },
    });
    return rows.map((w) => ({
      id: w.id,
      guestName: w.guestName,
      phone: w.phone,
      roomTypeFa: w.roomType.nameFa,
      fromDate: w.fromDate,
      toDate: w.toDate,
      units: w.units,
      status: w.status,
      note: w.note,
    }));
  }

  /** تبدیل رزرو گروهی به رزرو واقعی — اگر ظرفیت نیست، ۴۰۹ و همچنان در انتظار می‌ماند */
  async waitlistConvert(entryId: string, userId: string | null) {
    const entry = await this.prisma.waitlistEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waitlist entry not found' });
    if (entry.status !== 'WAITING') {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: 'این درخواست قبلاً تبدیل یا لغو شده است' });
    }
    const fromDate = entry.fromDate.toISOString().slice(0, 10);
    const toDate = entry.toDate.toISOString().slice(0, 10);
    const result = await this.confirm({
      roomTypeId: entry.roomTypeId,
      guestName: entry.guestName,
      checkInDate: fromDate,
      checkOutDate: toDate,
      idempotencyKey: `wtl-${entry.id}`,
      createdByUserId: userId ?? 'system:engine',
      units: entry.units,
      source: 'PHONE',
    });
    await this.prisma.waitlistEntry.update({
      where: { id: entryId },
      data: { status: 'CONVERTED', convertedReservationId: result.reservationId },
    });
    return { ...result, waitlistStatus: 'CONVERTED' };
  }

  async waitlistCancel(entryId: string) {
    const entry = await this.prisma.waitlistEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waitlist entry not found' });
    if (entry.status !== 'WAITING') {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: 'این درخواست قبلاً تبدیل یا لغو شده است' });
    }
    await this.prisma.waitlistEntry.update({ where: { id: entryId }, data: { status: 'CANCELLED' } });
    return { id: entryId, status: 'CANCELLED' };
  }
}
