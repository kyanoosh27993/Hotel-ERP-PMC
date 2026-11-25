/**
 * pms.service.ts — فاز ۴ (F4-T1…T3 + T7 + T8): نقشه اتاق، رزرواسیون توسعه‌یافته،
 * لیست انتظار، پذیرش (ورود/خروج اقامت چنداتاقه)، خانه‌داری پایه، حسابرسی شبانه.
 * قواعد: پول فقط BigInt ریال؛ کنترل هم‌زمانی با قفل مشورتی؛ رویدادها با Outbox هم‌تراکنشی.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Party } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import { mulRial } from '@hotel-erp/shared';
import { ReservationService } from '../reservations/reservation.service';
import { nextDocSeq } from '../common/doc-seq';
import { legalIdOk, mellicodeOk } from '../parties/parties.service';

export interface PmsReservationInput {
  roomTypeId: string;
  guestName: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string;
  idempotencyKey: string;
  createdByUserId: string;
  source?: 'PHONE' | 'WALK_IN' | 'ONLINE' | 'OTA';
  groupName?: string;
  adults?: number;
  children?: number;
  note?: string;
  nationality?: 'IRANIAN' | 'FOREIGNER'; // تفکیک مهمان ایرانی/خارجی
  rateOverrideRials?: string; // ارقام — نرخ توافقی (گروهی)
  partyId?: string; // پیوند با ثبت یکتای اشخاص (نیاز یکتایی کارفرما)
  planId?: string; // نسخهٔ ۳٫۴ — پلان تور/شرکت
}

export interface CheckInInput {
  idempotencyKey: string;
  createdByUserId: string;
  reservationId?: string;
  guestName?: string; // برای ورود حضوری بدون رزرو
  roomIds: string[];
  plannedCheckOut: string; // YYYY-MM-DD
  adults?: number;
  children?: number;
  rateOverrideRials?: string;
  partyId?: string; // رکورد یکتای مهمان — الزامی در گیت هویتی (رزروی و ورود حضوری)
  planId?: string; // نسخهٔ ۳٫۴ — پلان اقامت؛ پیش‌فرض پلان رزرو مبدأ
}

/** شب‌های اقامت از دو تاریخ — حداقل ۱ شب */
function nightsBetween(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`).getTime();
  const b = new Date(`${toDate}T00:00:00Z`).getTime();
  const n = Math.round((b - a) / 86400_000);
  return Math.max(n, 1);
}

@Injectable()
export class PmsService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  // ───────── F4-T1: نقشه اتاق ─────────

  async roomsMap() {
    const rooms = await this.prisma.room.findMany({
      include: { roomType: { select: { code: true, nameFa: true, nameEn: true, baseRateRials: true } } },
      orderBy: [{ floor: 'asc' }, { code: 'asc' }],
    });
    const byFloor = new Map<number, unknown[]>();
    const summary = { AVAILABLE: 0, OCCUPIED: 0, DIRTY: 0, OUT_OF_SERVICE: 0, HK_DIRTY: 0 };
    for (const r of rooms) {
      summary[r.status as keyof typeof summary] += 1;
      if (r.hkStatus === 'DIRTY' || r.hkStatus === 'IN_PROGRESS') summary.HK_DIRTY += 1;
      const row = {
        id: r.id,
        code: r.code,
        floor: r.floor,
        status: r.status,
        hkStatus: r.hkStatus,
        note: r.note,
        roomType: { code: r.roomType.code, nameFa: r.roomType.nameFa, baseRateRials: r.roomType.baseRateRials.toString() },
      };
      if (!byFloor.has(r.floor)) byFloor.set(r.floor, []);
      (byFloor.get(r.floor) as unknown[]).push(row);
    }
    return { summary, floors: Array.from(byFloor.entries()).map(([floor, rooms]) => ({ floor, rooms })) };
  }

  /** تغییر وضعیت اتاق — قواعد: اشغال فقط با پذیرش؛ اتاق اشغال مستقیم تغییر نمی‌کند؛ نظافت کامل DIRTY→AVAILABLE */
  async updateRoom(roomId: string, patch: {
    status?: string; hkStatus?: string; note?: string | null; code?: string; floor?: number; roomTypeId?: string;
    // نسخهٔ ۳٫۴ — فرم «تصحیح مشخصات اتاق»
    nameFa?: string | null; nameLatin?: string | null; bedCount?: number; orderInFloor?: number; extraBeds?: number;
    rateSingleRials?: string; rateDoubleRials?: string; rateTripleRials?: string; rateFullRials?: string;
    rateSingleUsd?: number; rateDoubleUsd?: number; rateTripleUsd?: number; rateFullUsd?: number;
    saleBlocked?: boolean; guestRequests?: number; registerNo?: number | null;
    lastChargeAt?: string | null; outOfServiceFrom?: string | null; outOfServiceCancelAt?: string | null;
    blockCard?: string | null; amenityIds?: string[];
  }) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room not found' });

    const data: {
      status?: 'AVAILABLE' | 'OCCUPIED' | 'DIRTY' | 'OUT_OF_SERVICE'; hkStatus?: 'CLEAN' | 'DIRTY' | 'IN_PROGRESS' | 'INSPECTED';
      note?: string | null; code?: string; floor?: number; roomTypeId?: string;
      nameFa?: string | null; nameLatin?: string | null; bedCount?: number; orderInFloor?: number; extraBeds?: number;
      rateSingleRials?: bigint; rateDoubleRials?: bigint; rateTripleRials?: bigint; rateFullRials?: bigint;
      rateSingleUsd?: number; rateDoubleUsd?: number; rateTripleUsd?: number; rateFullUsd?: number;
      saleBlocked?: boolean; guestRequests?: number; registerNo?: number | null;
      lastChargeAt?: Date | null; outOfServiceFrom?: Date | null; outOfServiceCancelAt?: Date | null; blockCard?: string | null;
    } = {};

    if (patch.status !== undefined) {
      if (patch.status === 'OCCUPIED') {
        throw new ConflictException({ code: 'BUSINESS_RULE', message: 'Occupancy is set only through check-in (F4-T3)' });
      }
      if (room.status === 'OCCUPIED') {
        throw new ConflictException({ code: 'BUSINESS_RULE', message: 'Room is occupied — check out the stay first' });
      }
      if (!['AVAILABLE', 'DIRTY', 'OUT_OF_SERVICE'].includes(patch.status)) {
        throw new ConflictException({ code: 'VALIDATION', message: 'Invalid room status' });
      }
      data.status = patch.status as typeof data.status;
    }

    if (patch.hkStatus !== undefined) {
      if (!['CLEAN', 'DIRTY', 'IN_PROGRESS', 'INSPECTED'].includes(patch.hkStatus)) {
        throw new ConflictException({ code: 'VALIDATION', message: 'Invalid housekeeping status' });
      }
      data.hkStatus = patch.hkStatus as typeof data.hkStatus;
      // قاعده T7: نظافت کامل روی اتاق کثیف → اتاق قابل فروش می‌شود
      if (patch.hkStatus === 'CLEAN' && room.status === 'DIRTY' && data.status === undefined) {
        data.status = 'AVAILABLE';
      }
    }

    if (patch.note !== undefined) data.note = patch.note;

    // تنظیم اتاق (درخواست کارفرما): ویرایش کد/طبقه/نوع اتاق
    if (patch.code !== undefined && patch.code !== room.code) {
      const dup = await this.prisma.room.findUnique({ where: { code: patch.code } });
      if (dup) throw new ConflictException({ code: 'VALIDATION', message: `Room code ${patch.code} already exists` });
      data.code = patch.code;
    }
    if (patch.floor !== undefined) {
      if (!Number.isInteger(patch.floor) || patch.floor < 0 || patch.floor > 99) {
        throw new ConflictException({ code: 'VALIDATION', message: 'Floor must be an integer between 0 and 99' });
      }
      data.floor = patch.floor;
    }
    if (patch.roomTypeId !== undefined) {
      const rt = await this.prisma.roomType.findUnique({ where: { id: patch.roomTypeId } });
      if (!rt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room type not found' });
      data.roomTypeId = patch.roomTypeId;
    }

    // نسخهٔ ۳٫۴ — فیلدهای فرم «تصحیح مشخصات اتاق»
    if (patch.nameFa !== undefined) data.nameFa = patch.nameFa || null;
    if (patch.nameLatin !== undefined) data.nameLatin = patch.nameLatin || null;
    if (patch.bedCount !== undefined) {
      if (!Number.isInteger(patch.bedCount) || patch.bedCount < 0 || patch.bedCount > 30) {
        throw new ConflictException({ code: 'VALIDATION', message: 'تعداد تخت باید عددی بین ۰ تا ۳۰ باشد' });
      }
      data.bedCount = patch.bedCount;
    }
    if (patch.orderInFloor !== undefined) {
      if (!Number.isInteger(patch.orderInFloor) || patch.orderInFloor < 0 || patch.orderInFloor > 999) {
        throw new ConflictException({ code: 'VALIDATION', message: 'ردیف در طبقه باید عددی بین ۰ تا ۹۹۹ باشد' });
      }
      data.orderInFloor = patch.orderInFloor;
    }
    if (patch.extraBeds !== undefined) {
      if (!Number.isInteger(patch.extraBeds) || patch.extraBeds < 0 || patch.extraBeds > 10) {
        throw new ConflictException({ code: 'VALIDATION', message: 'تخت اضافه باید عددی بین ۰ تا ۱۰ باشد' });
      }
      data.extraBeds = patch.extraBeds;
    }
    const rialFields: Array<['rateSingleRials' | 'rateDoubleRials' | 'rateTripleRials' | 'rateFullRials', string]> = [
      ['rateSingleRials', 'rateSingleRials'], ['rateDoubleRials', 'rateDoubleRials'],
      ['rateTripleRials', 'rateTripleRials'], ['rateFullRials', 'rateFullRials'],
    ];
    for (const [k, col] of rialFields) {
      const v = patch[k];
      if (v !== undefined) {
        if (!/^\d+$/.test(String(v))) throw new ConflictException({ code: 'VALIDATION', message: `${col} باید عدد صحیح ریالی باشد` });
        data[col as 'rateSingleRials'] = BigInt(String(v));
      }
    }
    for (const k of ['rateSingleUsd', 'rateDoubleUsd', 'rateTripleUsd', 'rateFullUsd'] as const) {
      if (patch[k] !== undefined) data[k] = patch[k];
    }
    if (patch.saleBlocked !== undefined) data.saleBlocked = patch.saleBlocked;
    if (patch.guestRequests !== undefined) {
      if (!Number.isInteger(patch.guestRequests) || patch.guestRequests < 0 || patch.guestRequests > 99) {
        throw new ConflictException({ code: 'VALIDATION', message: 'درخواست مهمان باید عددی بین ۰ تا ۹۹ باشد' });
      }
      data.guestRequests = patch.guestRequests;
    }
    if (patch.registerNo !== undefined) data.registerNo = patch.registerNo;
    if (patch.blockCard !== undefined) data.blockCard = patch.blockCard;
    for (const k of ['lastChargeAt', 'outOfServiceFrom', 'outOfServiceCancelAt'] as const) {
      const v = patch[k];
      if (v !== undefined) data[k] = v ? new Date(String(v)) : null;
    }
    if (patch.amenityIds !== undefined) {
      const amenities = await this.prisma.roomAmenity.findMany({ where: { id: { in: patch.amenityIds } } });
      if (amenities.length !== patch.amenityIds.length) {
        throw new ConflictException({ code: 'VALIDATION', message: 'یک یا چند مشخصه یافت نشد' });
      }
      await this.prisma.roomAmenityLink.deleteMany({ where: { roomId } });
      if (patch.amenityIds.length) {
        await this.prisma.roomAmenityLink.createMany({ data: patch.amenityIds.map((aid) => ({ roomId, amenityId: aid })) });
      }
    }

    const updated = await this.prisma.room.update({ where: { id: roomId }, data }).catch((e: { code?: string }) => {
      if (e && e.code === 'P2002') throw new ConflictException({ code: 'VALIDATION', message: 'Room code already exists' });
      throw e;
    });
    return {
      id: updated.id, code: updated.code, floor: updated.floor, roomTypeId: updated.roomTypeId,
      status: updated.status, hkStatus: updated.hkStatus, note: updated.note,
      nameFa: updated.nameFa, nameLatin: updated.nameLatin, bedCount: updated.bedCount,
      orderInFloor: updated.orderInFloor, extraBeds: updated.extraBeds, saleBlocked: updated.saleBlocked,
      guestRequests: updated.guestRequests, registerNo: updated.registerNo, blockCard: updated.blockCard,
      tourCompany: updated.tourCompany,
    };
  }

  // ───────── F4-T2: رزرواسیون توسعه‌یافته (کانال/گروه/لیست انتظار) ─────────

  async createReservation(input: PmsReservationInput) {
    const nights = ReservationService.calcNights(input.checkInDate, input.checkOutDate);

    const existing = await this.prisma.reservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { reservationId: existing.id, code: existing.code, replayed: true };

    const roomType = await this.prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
    if (!roomType) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room type not found' });
    const nightly = input.rateOverrideRials ? BigInt(input.rateOverrideRials) : roomType.baseRateRials;
    const total = mulRial(nightly, nights);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${input.roomTypeId})) AS l) t`;
      // کنترل ظرفیت واقعی (F4-T2): هم‌پوشانی‌ها نباید از تعداد اتاق‌های همین نوع بیشتر شود
      const overlapping = await tx.reservation.count({
        where: {
          roomTypeId: input.roomTypeId,
          status: { in: ['CONFIRMED', 'CHECKED_IN'] },
          checkIn: { lt: new Date(`${input.checkOutDate}T00:00:00Z`) },
          checkOut: { gt: new Date(`${input.checkInDate}T00:00:00Z`) },
        },
      });
      const roomsOfType = await tx.room.count({ where: { roomTypeId: input.roomTypeId } });
      if (overlapping >= roomsOfType) {
        throw new ConflictException({ code: 'CONFLICT', message: `Room type capacity exhausted (${roomsOfType} rooms) for the requested range` });
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
          source: input.source ?? 'PHONE',
          groupName: input.groupName,
          adults: input.adults ?? 1,
          children: input.children ?? 0,
          note: input.note,
          nationality: input.nationality ?? null,
          partyId: input.partyId ?? null,
          planId: input.planId ?? null,
        },
      });
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
          source: input.source ?? 'PHONE',
          groupName: input.groupName ?? null,
        },
      });
      return { reservationId: reservation.id, code, replayed: false };
    });
  }

  /**
   * F5 گیت — لغو رزرو (باگ #۵ لاگ باگ: endpoint لغو وجود نداشت).
   * فقط رزرو CONFIRMED قابل لغو است؛ پس از چک‌این مسیر تسویه/چک‌اوت الزامی است.
   * رویداد cancellation → مصرف‌کننده سند معکوس می‌زند (۴۱۰۱ بدهکار / ۱۲۰۱ بستانکار).
   */
  async cancelReservation(reservationId: string, cancelledByUserId: string) {
    const existing = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!existing) throw new ConflictException({ code: 'NOT_FOUND', message: 'Reservation not found' });
    if (existing.status !== 'CONFIRMED') {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: `Only CONFIRMED reservations can be cancelled (current: ${existing.status})` });
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.RESERVATION_CANCELLED,
        aggregate: 'reservation',
        idempotencyKey: `cancel:${reservationId}`,
        producer: 'booking',
        payload: {
          reservationId,
          guestName: updated.guestName,
          nights: updated.nights,
          totalAmountRials: Number(updated.totalRials),
        },
      });
      void cancelledByUserId;
      return { reservationId, code: updated.code, cancelledAt: (updated.cancelledAt ?? new Date()).toISOString(), replayed: false };
    });
  }

  async listReservations(filter: { status?: string; date?: string; from?: string; to?: string; nationality?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.date) where.checkIn = new Date(`${filter.date}T00:00:00Z`);
    // بازهٔ زمانی گزارش (درخواست کارفرما): از/تا روی checkIn
    if (filter.from || filter.to) {
      const range: Record<string, Date> = {};
      if (filter.from) range.gte = new Date(`${filter.from}T00:00:00Z`);
      if (filter.to) range.lte = new Date(`${filter.to}T00:00:00Z`);
      where.checkIn = range;
    }
    if (filter.nationality) where.nationality = filter.nationality;
    const rows = await this.prisma.reservation.findMany({
      where,
      include: { roomType: { select: { code: true, nameFa: true } } },
      orderBy: [{ checkIn: 'desc' }, { code: 'asc' }],
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      guestName: r.guestName,
      roomType: r.roomType.code,
      roomTypeNameFa: r.roomType.nameFa,
      checkIn: r.checkIn.toISOString().slice(0, 10),
      checkOut: r.checkOut.toISOString().slice(0, 10),
      nights: r.nights,
      totalRials: r.totalRials.toString(),
      status: r.status,
      source: r.source,
      groupName: r.groupName,
      nationality: r.nationality ?? null,
    }));
  }

  // ───────── F4-T2: لیست انتظار ─────────

  async createWaitlist(input: { guestName: string; phone?: string; roomTypeId: string; fromDate: string; toDate: string; note?: string; createdByUserId: string }) {
    const roomType = await this.prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
    if (!roomType) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room type not found' });
    const row = await this.prisma.waitlistEntry.create({
      data: {
        guestName: input.guestName,
        phone: input.phone,
        roomTypeId: input.roomTypeId,
        fromDate: new Date(`${input.fromDate}T00:00:00Z`),
        toDate: new Date(`${input.toDate}T00:00:00Z`),
        note: input.note,
        createdById: input.createdByUserId === 'system:engine' ? null : input.createdByUserId,
      },
    });
    return { id: row.id, status: row.status };
  }

  async listWaitlist(status?: string) {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: status ? { status: status as 'WAITING' | 'OFFERED' | 'BOOKED' | 'CANCELLED' } : {},
      include: { roomType: { select: { code: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((w) => ({
      id: w.id,
      guestName: w.guestName,
      phone: w.phone,
      roomType: w.roomType.code,
      fromDate: w.fromDate.toISOString().slice(0, 10),
      toDate: w.toDate.toISOString().slice(0, 10),
      status: w.status,
      note: w.note,
    }));
  }

  async updateWaitlist(id: string, status: string) {
    if (!['WAITING', 'OFFERED', 'BOOKED', 'CANCELLED'].includes(status)) {
      throw new ConflictException({ code: 'VALIDATION', message: 'Invalid waitlist status' });
    }
    const row = await this.prisma.waitlistEntry.update({
      where: { id },
      data: { status: status as 'WAITING' | 'OFFERED' | 'BOOKED' | 'CANCELLED' },
    });
    return { id: row.id, status: row.status };
  }

  // ───────── F4-T3: پذیرش — ورود (اقامت تک/چنداتاقه) ─────────

  async checkIn(input: CheckInInput) {
    const roomIds = Array.from(new Set(input.roomIds));
    if (roomIds.length === 0) throw new ConflictException({ code: 'VALIDATION', message: 'roomIds is empty' });

    const existing = await this.prisma.stay.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const rooms = await this.prisma.stayRoom.findMany({ where: { stayId: existing.id }, include: { room: true } });
      return { stayId: existing.id, code: existing.code, rooms: rooms.map((sr) => sr.room.code), replayed: true };
    }

    if (!input.reservationId && !input.guestName) {
      throw new ConflictException({ code: 'VALIDATION', message: 'reservationId or guestName is required' });
    }

    return this.prisma.$transaction(async (tx) => {
      // قفل مشورتی روی هر اتاق — جلوگیری از پذیرش هم‌زمان دو مهمان روی یک اتاق
      for (const roomId of roomIds) {
        await tx.$queryRaw`SELECT true AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`stay:${roomId}`})) AS l) t`;
      }

      const rooms = await tx.room.findMany({ where: { id: { in: roomIds } }, include: { roomType: true } });
      if (rooms.length !== roomIds.length) throw new NotFoundException({ code: 'NOT_FOUND', message: 'One or more rooms not found' });
      for (const r of rooms) {
        if (r.status !== 'AVAILABLE') {
          throw new ConflictException({ code: 'CONFLICT', message: `Room ${r.code} is not AVAILABLE (current: ${r.status})` });
        }
        if (r.hkStatus === 'DIRTY' || r.hkStatus === 'IN_PROGRESS') {
          throw new ConflictException({ code: 'BUSINESS_RULE', message: `Room ${r.code} is not cleaned yet (housekeeping: ${r.hkStatus})` });
        }
      }

      let reservation = null;
      if (input.reservationId) {
        reservation = await tx.reservation.findUnique({ where: { id: input.reservationId } });
        if (!reservation) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reservation not found' });
        if (reservation.status === 'CHECKED_IN') throw new ConflictException({ code: 'CONFLICT', message: 'Reservation already checked in' });
        if (reservation.status !== 'CONFIRMED') throw new ConflictException({ code: 'CONFLICT', message: `Reservation is ${reservation.status}, not CONFIRMED` });
        for (const r of rooms) {
          if (r.roomTypeId !== reservation.roomTypeId) {
            throw new ConflictException({ code: 'BUSINESS_RULE', message: `Room ${r.code} type does not match reserved room type` });
          }
        }
      }

      // گیت هویتی سختگیرانه (نیاز کارفرما) — برای همهٔ چک‌این‌ها: رزروی و ورود حضوری، قدیمی و جدید.
      // شخص حقیقی: کد ملی ۱۰ رقم معتبر + کد پستی ۱۰ رقم | حقوقی: شناسهٔ ملی + کد اقتصادی | خارجی: سند شناسایی.
      const effectivePartyId = input.partyId ?? reservation?.partyId ?? null;
      if (!effectivePartyId) {
        throw new ConflictException({
          code: 'IDENTITY_REQUIRED',
          message: 'چک‌این بدون رکورد یکتای مهمان مجاز نیست — در پنل «پذیرش» فیلد «رکورد یکتای مهمان» را با جستجوی زنده (نام/کد ملی) انتخاب کنید. رزروهای قدیمی هم باید پیش از چک‌این به رکورد یکتا با کد ملی/شناسهٔ ملی معتبر متصل شوند.',
          details: { needParty: true, reservationId: reservation?.id ?? null },
        });
      }
      const identityParty = await tx.party.findUnique({ where: { id: effectivePartyId } });
      if (!identityParty) throw new NotFoundException({ code: 'NOT_FOUND', message: 'رکورد یکتای مهمان یافت نشد' });
      this.assertPartyIdentity(identityParty);
      if (reservation && !reservation.partyId) {
        // رزرو قدیمی با انتخاب رکورد یکتا در چک‌این، برای همیشه پیوند می‌خورد
        await tx.reservation.update({ where: { id: reservation.id }, data: { partyId: effectivePartyId } });
      }

      const seq = await nextDocSeq(tx, 'stay');
      const code = `STY-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
      const guestName = reservation?.guestName ?? input.guestName ?? '';
      // پلان اقامت: صریح از ورودی، وگرنه پلان رزرو مبدأ (نسخهٔ ۳٫۴)
      const effectivePlanId = input.planId ?? reservation?.planId ?? null;
      const stay = await tx.stay.create({
        data: {
          code,
          reservationId: reservation?.id ?? null,
          guestName,
          adults: input.adults ?? reservation?.adults ?? 1,
          children: input.children ?? reservation?.children ?? 0,
          status: 'OPEN',
          plannedCheckOut: new Date(`${input.plannedCheckOut}T00:00:00Z`),
          idempotencyKey: input.idempotencyKey,
          createdById: input.createdByUserId === 'system:engine' ? null : input.createdByUserId,
          planId: effectivePlanId,
          rooms: {
            create: rooms.map((r) => ({
              roomId: r.id,
              rateOverrideRials: input.rateOverrideRials ? BigInt(input.rateOverrideRials) : null,
            })),
          },
        },
        include: { rooms: { include: { room: true } } },
      });

      await tx.room.updateMany({
        where: { id: { in: roomIds } },
        data: { status: 'OCCUPIED', tourCompany: reservation?.groupName ?? null },
      });
      if (reservation) {
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'CHECKED_IN' } });
      }

      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.STAY_CHECKED_IN,
        aggregate: 'stay',
        idempotencyKey: stay.id,
        producer: 'pms',
        payload: {
          stayId: stay.id,
          code,
          reservationId: reservation?.id ?? null,
          roomIds,
          roomCodes: rooms.map((r) => r.code),
          guestName,
          plannedCheckOut: input.plannedCheckOut,
        },
      });

      return { stayId: stay.id, code, rooms: rooms.map((r) => r.code), replayed: false };
    });
  }

  // ───────── F4-T3 + F4-T7: خروج → اتاق کثیف برای خانه‌داری ─────────

  async checkOut(stayId: string) {
    return this.prisma.$transaction(async (tx) => {
      const stay = await tx.stay.findUnique({
        where: { id: stayId },
        include: { rooms: { include: { room: { include: { roomType: true } } } }, reservation: true },
      });
      if (!stay) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stay not found' });
      if (stay.status !== 'OPEN') throw new ConflictException({ code: 'CONFLICT', message: 'Stay already closed' });

      const today = new Date().toISOString().slice(0, 10);
      const checkInDate = stay.checkInAt.toISOString().slice(0, 10);
      const nights = nightsBetween(checkInDate, today);
      // باگ #۷: فولیو قبلاً overwrite می‌شد و خدمات اقامت (روم‌سرویس و…) حذف می‌شد.
      // مدل درست: فولیوی انباشته (شب‌های شارژشدهٔ شب‌گردی + خدمات) + شب‌های هنوز
      // شارژنشده = کل شب‌ها − تعداد شب‌گردی‌های اجراشده از ورود تا خروج (شامل).
      // شب‌گردی‌ای این اقامت را شارژ کرده که «هنگام اجرا» اقامت باز بوده:
      // businessDate در بازهٔ [ورود، خروج] و زمان اجرا (closedAt) بعد از چک‌این.
      const chargedNights = await tx.nightAuditRun.count({
        where: {
          businessDate: {
            gte: new Date(`${checkInDate}T00:00:00Z`),
            lte: new Date(`${today}T00:00:00Z`),
          },
          closedAt: { gte: stay.checkInAt },
        },
      });
      const remainingNights = Math.max(0, nights - chargedNights);
      let folio = stay.folioRials;
      const roomCodes: string[] = [];
      for (const sr of stay.rooms) {
        const nightly = sr.rateOverrideRials ?? sr.room.roomType.baseRateRials;
        folio += BigInt(nightly) * BigInt(remainingNights);
        roomCodes.push(sr.room.code);
      }

      const updated = await tx.stay.update({
        where: { id: stayId },
        data: { status: 'CLOSED', actualCheckOutAt: new Date(), folioRials: folio },
      });
      await tx.room.updateMany({
        where: { id: { in: stay.rooms.map((sr) => sr.roomId) } },
        data: { status: 'DIRTY', hkStatus: 'DIRTY' }, // خروج → آماده نظافت (F4-T7)
      });
      if (stay.reservationId) {
        await tx.reservation.update({ where: { id: stay.reservationId }, data: { status: 'CHECKED_OUT' } });
      }

      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.STAY_CHECKED_OUT,
        aggregate: 'stay',
        idempotencyKey: `checkout:${updated.id}:${updated.actualCheckOutAt?.toISOString()}`,
        producer: 'pms',
        payload: {
          stayId: updated.id,
          code: updated.code,
          roomCodes,
          nights,
          folioRials: Number(folio),
          guestName: updated.guestName,
        },
      });

      return { stayId: updated.id, code: updated.code, nights, folioRials: folio.toString(), rooms: roomCodes };
    });
  }

  async listStays(status?: string) {
    const rows = await this.prisma.stay.findMany({
      where: status ? { status: status as 'OPEN' | 'CLOSED' } : {},
      include: {
        rooms: { include: { room: { select: { code: true } } } },
        reservation: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      guestName: s.guestName,
      reservationCode: s.reservation?.code ?? null,
      rooms: s.rooms.map((sr) => sr.room.code),
      status: s.status,
      checkInAt: s.checkInAt.toISOString(),
      plannedCheckOut: s.plannedCheckOut.toISOString().slice(0, 10),
      folioRials: s.folioRials.toString(),
    }));
  }

  // ───────── تنظیمات اتاق‌ها (درخواست کارفرما: طبقه/نوع/نرخ قابل ویرایش) ─────────

  async listRoomTypes() {
    const rows = await this.prisma.roomType.findMany({
      include: { _count: { select: { rooms: true } } },
      orderBy: { code: 'asc' },
    });
    return rows.map((rt) => ({
      id: rt.id,
      code: rt.code,
      nameEn: rt.nameEn,
      nameFa: rt.nameFa,
      capacity: rt.capacity,
      baseRateRials: rt.baseRateRials.toString(),
      roomsCount: rt._count.rooms,
    }));
  }

  async createRoomType(input: { code: string; nameEn: string; nameFa: string; capacity?: number; baseRateRials: string }) {
    const dup = await this.prisma.roomType.findUnique({ where: { code: input.code } });
    if (dup) throw new ConflictException({ code: 'VALIDATION', message: `Room type code ${input.code} already exists` });
    if (!/^\d+$/.test(input.baseRateRials)) throw new ConflictException({ code: 'VALIDATION', message: 'baseRateRials must be integer digits (Rials)' });
    const rt = await this.prisma.roomType.create({
      data: { code: input.code, nameEn: input.nameEn, nameFa: input.nameFa, capacity: input.capacity ?? 2, baseRateRials: BigInt(input.baseRateRials) },
    });
    return { id: rt.id, code: rt.code, nameFa: rt.nameFa, capacity: rt.capacity, baseRateRials: rt.baseRateRials.toString() };
  }

  async updateRoomType(id: string, patch: { nameFa?: string; nameEn?: string; capacity?: number; baseRateRials?: string }) {
    const rt = await this.prisma.roomType.findUnique({ where: { id } });
    if (!rt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room type not found' });
    const data: { nameFa?: string; nameEn?: string; capacity?: number; baseRateRials?: bigint } = {};
    if (patch.nameFa !== undefined) data.nameFa = patch.nameFa;
    if (patch.nameEn !== undefined) data.nameEn = patch.nameEn;
    if (patch.capacity !== undefined) {
      if (!Number.isInteger(patch.capacity) || patch.capacity < 1 || patch.capacity > 10) {
        throw new ConflictException({ code: 'VALIDATION', message: 'Capacity must be between 1 and 10' });
      }
      data.capacity = patch.capacity;
    }
    if (patch.baseRateRials !== undefined) {
      if (!/^\d+$/.test(patch.baseRateRials)) throw new ConflictException({ code: 'VALIDATION', message: 'baseRateRials must be integer digits (Rials)' });
      data.baseRateRials = BigInt(patch.baseRateRials);
    }
    const updated = await this.prisma.roomType.update({ where: { id }, data });
    return { id: updated.id, code: updated.code, nameFa: updated.nameFa, capacity: updated.capacity, baseRateRials: updated.baseRateRials.toString() };
  }

  async createRoom(input: {
    code: string; floor: number; roomTypeId: string;
    nameFa?: string; nameLatin?: string; bedCount?: number; orderInFloor?: number; extraBeds?: number;
    rateSingleRials?: string; rateDoubleRials?: string; rateTripleRials?: string; rateFullRials?: string;
    rateSingleUsd?: number; rateDoubleUsd?: number; rateTripleUsd?: number; rateFullUsd?: number;
    note?: string; registerNo?: number; saleBlocked?: boolean; amenityIds?: string[];
  }) {
    const dup = await this.prisma.room.findUnique({ where: { code: input.code } });
    if (dup) throw new ConflictException({ code: 'VALIDATION', message: `Room code ${input.code} already exists` });
    if (!Number.isInteger(input.floor) || input.floor < 0 || input.floor > 99) {
      throw new ConflictException({ code: 'VALIDATION', message: 'Floor must be an integer between 0 and 99' });
    }
    const rt = await this.prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
    if (!rt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room type not found' });
    if (input.extraBeds !== undefined && (!Number.isInteger(input.extraBeds) || input.extraBeds < 0 || input.extraBeds > 10)) {
      throw new ConflictException({ code: 'VALIDATION', message: 'تخت اضافه باید عددی بین ۰ تا ۱۰ باشد' });
    }
    if (input.bedCount !== undefined && (!Number.isInteger(input.bedCount) || input.bedCount < 0 || input.bedCount > 30)) {
      throw new ConflictException({ code: 'VALIDATION', message: 'تعداد تخت باید عددی بین ۰ تا ۳۰ باشد' });
    }
    if (input.orderInFloor !== undefined && (!Number.isInteger(input.orderInFloor) || input.orderInFloor < 0 || input.orderInFloor > 999)) {
      throw new ConflictException({ code: 'VALIDATION', message: 'ردیف در طبقه باید عددی بین ۰ تا ۹۹۹ باشد' });
    }
    const data: Record<string, unknown> = {
      code: input.code, floor: input.floor, roomTypeId: input.roomTypeId,
      nameFa: input.nameFa ?? rt.nameFa, nameLatin: input.nameLatin ?? rt.nameLatin ?? null,
      bedCount: input.bedCount ?? rt.bedCount, orderInFloor: input.orderInFloor ?? 0,
      extraBeds: input.extraBeds ?? 0, note: input.note ?? null, registerNo: input.registerNo ?? null,
      saleBlocked: input.saleBlocked ?? false,
    };
    for (const [k, col] of [
      ['rateSingleRials', 'rateSingleRials'], ['rateDoubleRials', 'rateDoubleRials'],
      ['rateTripleRials', 'rateTripleRials'], ['rateFullRials', 'rateFullRials'],
    ] as Array<[keyof typeof input, string]>) {
      const v = input[k];
      if (v !== undefined) {
        if (!/^\d+$/.test(String(v))) throw new ConflictException({ code: 'VALIDATION', message: `${col} باید عدد صحیح ریالی باشد` });
        data[col as 'rateSingleRials'] = BigInt(String(v));
      }
    }
    for (const k of ['rateSingleUsd', 'rateDoubleUsd', 'rateTripleUsd', 'rateFullUsd'] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    const room = await this.prisma.room.create({ data: data as never });
    if (input.amenityIds?.length) {
      const amenities = await this.prisma.roomAmenity.findMany({ where: { id: { in: input.amenityIds } } });
      if (amenities.length !== input.amenityIds.length) {
        throw new ConflictException({ code: 'VALIDATION', message: 'یک یا چند مشخصه یافت نشد' });
      }
      await this.prisma.roomAmenityLink.createMany({ data: input.amenityIds.map((aid) => ({ roomId: room.id, amenityId: aid })) });
    }
    return { id: room.id, code: room.code, floor: room.floor, roomTypeId: room.roomTypeId, status: room.status };
  }

  async deleteRoom(roomId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: { _count: { select: { stayRooms: true } } } });
    if (!room) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room not found' });
    if (room.status === 'OCCUPIED') throw new ConflictException({ code: 'BUSINESS_RULE', message: 'Room is occupied — check out the stay first' });
    if (room._count.stayRooms > 0) {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: 'Room has stay history — close it (OUT_OF_SERVICE) instead of deleting' });
    }
    await this.prisma.room.delete({ where: { id: roomId } });
    return { deleted: room.code };
  }

  // ───────── فولیو — اقلام اضافی اتاق و صورتحساب‌های باز (مرجع 4.zip) ─────────

  async addFolioItem(stayId: string, input: { desc: string; qty: number; unitRials: string; createdByUserId: string; revenueCodeId?: string }) {
    const stay = await this.prisma.stay.findUnique({ where: { id: stayId } });
    if (!stay) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stay not found' });
    if (stay.status !== 'OPEN') throw new ConflictException({ code: 'BUSINESS_RULE', message: 'Stay is closed — folio is settled' });
    if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 999) {
      throw new ConflictException({ code: 'VALIDATION', message: 'qty must be between 1 and 999' });
    }
    if (!/^\d+$/.test(input.unitRials)) throw new ConflictException({ code: 'VALIDATION', message: 'unitRials must be integer digits (Rials)' });
    // نسخهٔ ۳٫۴ — مسیر صورت‌حساب قلم از پلان اقامت تعیین می‌شود (میهمان یا تور/شرکت)
    let chargeTo: string | null = null;
    let revenueCodeId: string | null = null;
    if (input.revenueCodeId) {
      const rc = await this.prisma.revenueCode.findUnique({ where: { id: input.revenueCodeId } });
      if (!rc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'کد درآمدی یافت نشد' });
      revenueCodeId = input.revenueCodeId;
      const planId = stay.planId ?? (await this.prisma.stay.findUnique({ where: { id: stayId }, select: { reservation: { select: { planId: true } } } }))?.reservation?.planId ?? null;
      if (planId) {
        const planItem = await this.prisma.planItem.findUnique({
          where: { planId_revenueCodeId: { planId, revenueCodeId } },
        });
        chargeTo = planItem?.chargeTo ?? 'GUEST';
      } else {
        chargeTo = 'GUEST';
      }
    }
    const unit = BigInt(input.unitRials);
    const total = unit * BigInt(input.qty);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.folioItem.create({
        data: {
          stayId,
          desc: input.desc,
          qty: input.qty,
          unitRials: unit,
          totalRials: total,
          createdById: input.createdByUserId === 'system:engine' ? null : input.createdByUserId,
          revenueCodeId,
          chargeTo,
        },
      });
      await tx.stay.update({ where: { id: stayId }, data: { folioRials: { increment: total } } });
      return { id: item.id, desc: item.desc, qty: item.qty, unitRials: item.unitRials.toString(), totalRials: item.totalRials.toString(), revenueCodeId: item.revenueCodeId, chargeTo: item.chargeTo ?? 'GUEST' };
    });
  }

  async listFolioItems(stayId: string) {
    const stay = await this.prisma.stay.findUnique({
      where: { id: stayId },
      include: { folioItems: { orderBy: { postedAt: 'desc' }, include: { revenue: true } }, rooms: { include: { room: { select: { code: true } } } } },
    });
    if (!stay) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stay not found' });
    return {
      stay: { id: stay.id, code: stay.code, guestName: stay.guestName, status: stay.status, rooms: stay.rooms.map((sr) => sr.room.code), planId: stay.planId },
      folioRials: stay.folioRials.toString(),
      items: stay.folioItems.map((f) => ({
        id: f.id,
        desc: f.desc,
        qty: f.qty,
        unitRials: f.unitRials.toString(),
        totalRials: f.totalRials.toString(),
        postedAt: f.postedAt.toISOString(),
        revenueCode: f.revenue ? { id: f.revenue.id, code: f.revenue.code, nameFa: f.revenue.nameFa } : null,
        chargeTo: f.chargeTo ?? 'GUEST', // نسخهٔ ۳٫۴ — میهمان یا تور/شرکت
      })),
    };
  }

  /** لیست صورتحساب‌های باز مهمان (Open Invoices Guests List — مرجع) */
  async openFolios() {
    const rows = await this.prisma.stay.findMany({
      where: { status: 'OPEN' },
      include: {
        rooms: { include: { room: { select: { code: true } } } },
        folioItems: { orderBy: { postedAt: 'desc' } },
      },
      orderBy: { checkInAt: 'asc' },
      take: 200,
    });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      guestName: s.guestName,
      rooms: s.rooms.map((sr) => sr.room.code),
      checkInAt: s.checkInAt.toISOString(),
      plannedCheckOut: s.plannedCheckOut.toISOString().slice(0, 10),
      folioRials: s.folioRials.toString(),
      itemsCount: s.folioItems.length,
      lastItem: s.folioItems[0] ? s.folioItems[0].desc : null,
    }));
  }

  // ───────── F4-T8: حسابرسی شبانه ─────────

  /**
   * حسابرسی شبانه — با شارژ بهای اتاق (نقشه ۷.۱): هر اقامت باز به‌ازای هر اتاق اشغالش
   * یک شب هزینه می‌شود (نرخ رزرو یا نرخ پایهٔ نوع اتاق) → فولیو + رویداد پولی سند.
   */
  async nightAudit(businessDate: string, closedByUserId: string) {
    const exists = await this.prisma.nightAuditRun.findUnique({ where: { businessDate: new Date(`${businessDate}T00:00:00Z`) } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: `Night audit for ${businessDate} already ran` });

    const date = new Date(`${businessDate}T00:00:00Z`);
    return this.prisma.$transaction(async (tx) => {
      const openStays = await tx.stay.findMany({
        where: { status: 'OPEN' },
        include: {
          rooms: { include: { room: { include: { roomType: true } } } },
        },
      });

      // شارژ شب: نرخ هر اتاق اشغال هر اقامت باز — یک شب به‌ازای این شب‌گردی
      // (نرخ توافقی سطر اقامت در اولویت؛ وگرنه نرخ پایهٔ نوع اتاق)
      let totalCharged = 0n;
      const charges: Array<{ stayCode: string; roomCode: string; rateRials: number }> = [];
      for (const stay of openStays) {
        let stayCharge = 0n;
        for (const sr of stay.rooms) {
          const rate = BigInt(sr.rateOverrideRials ?? sr.room.roomType.baseRateRials);
          stayCharge += rate;
          charges.push({ stayCode: stay.code, roomCode: sr.room.code, rateRials: Number(rate) });
        }
        if (stayCharge > 0n) {
          await tx.stay.update({ where: { id: stay.id }, data: { folioRials: { increment: stayCharge } } });
          totalCharged += stayCharge;
        }
      }

      const dirtyRooms = await tx.room.findMany({
        where: { OR: [{ status: 'DIRTY' }, { hkStatus: 'DIRTY' }, { hkStatus: 'IN_PROGRESS' }] },
        select: { code: true },
      });
      const arrivals = await tx.reservation.findMany({
        where: { checkIn: date, status: 'CONFIRMED' },
        select: { code: true, guestName: true },
      });

      const exceptions = {
        openStays: openStays.map((s) => s.code),
        dirtyRooms: dirtyRooms.map((r) => r.code),
        arrivalsNotCheckedIn: arrivals.map((a) => `${a.code} — ${a.guestName}`),
      };
      const hasExceptions = openStays.length > 0 || dirtyRooms.length > 0 || arrivals.length > 0;

      const run = await tx.nightAuditRun.create({
        data: {
          businessDate: date,
          status: hasExceptions ? 'WITH_EXCEPTIONS' : 'OK',
          openStays: openStays.length,
          dirtyRooms: dirtyRooms.length,
          arrivalsNotCheckedIn: arrivals.length,
          exceptions: exceptions as unknown as import('@prisma/client').Prisma.InputJsonValue,
          closedById: closedByUserId === 'system:engine' ? null : closedByUserId,
        },
      });

      // رویداد پولی شارژ شب → سند خودکار (بدهکار حساب مهمان / بستانکار درآمد اتاق)
      if (totalCharged > 0n) {
        await this.outbox.enqueue(tx, {
          eventName: EVENT_NAMES.NIGHT_AUDIT_POSTED,
          aggregate: 'night_audit',
          idempotencyKey: `pms.night.${businessDate}`,
          payload: {
            businessDate,
            chargedRials: Number(totalCharged),
            stays: charges,
          } as unknown as Record<string, unknown>,
          producer: 'pms',
        });
      }

      return {
        id: run.id,
        businessDate,
        status: run.status,
        openStays: run.openStays,
        dirtyRooms: run.dirtyRooms,
        arrivalsNotCheckedIn: run.arrivalsNotCheckedIn,
        chargedRials: Number(totalCharged),
        charges,
        exceptions,
      };
    });
  }

  async listNightAudits() {
    const rows = await this.prisma.nightAuditRun.findMany({ orderBy: { businessDate: 'desc' }, take: 100 });
    return rows.map((r) => ({
      id: r.id,
      businessDate: r.businessDate.toISOString().slice(0, 10),
      status: r.status,
      openStays: r.openStays,
      dirtyRooms: r.dirtyRooms,
      arrivalsNotCheckedIn: r.arrivalsNotCheckedIn,
      closedAt: r.closedAt.toISOString(),
    }));
  }

  /**
   * اتصال رکورد یکتای مهمان به رزرو — مسیر اصلاح رزروهای قدیمیِ بدون party.
   * الزام «کد معتبر» در گیت چک‌این نهایی اعمال می‌شود؛ اینجا فهرست ناقص‌ها هشدار داده می‌شود.
   */
  async attachParty(reservationId: string, partyId: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reservation not found' });
    if (reservation.status !== 'CONFIRMED') {
      throw new ConflictException({ code: 'CONFLICT', message: `Reservation is ${reservation.status}, not CONFIRMED` });
    }
    const party = await this.prisma.party.findUnique({ where: { id: partyId } });
    if (!party) throw new NotFoundException({ code: 'NOT_FOUND', message: 'رکورد یکتای مهمان یافت نشد' });
    const updated = await this.prisma.reservation.update({ where: { id: reservationId }, data: { partyId } });
    const missing: string[] = [];
    const legal = !!(party.natIdentifier || party.economicCode);
    if (party.nationality === 'FOREIGNER') {
      if (!party.idDocNo) missing.push('شماره شناسنامه/پاسپورت');
      if (!party.postalCode) missing.push('کد پستی (۱۰ رقم)');
    } else if (legal) {
      if (!party.natIdentifier) missing.push('شناسهٔ ملی (۱۱ رقم)');
      if (!party.economicCode) missing.push('کد اقتصادی (۱۱ تا ۱۴ رقم)');
    } else {
      if (!party.nationalId) missing.push('کد ملی (۱۰ رقم)');
      if (!party.postalCode) missing.push('کد پستی (۱۰ رقم)');
    }
    return { reservationId: updated.id, partyId, code: updated.code, incomplete: missing };
  }

  /**
   * گیت هویتی (نیاز کارفرما — سخت‌گیری کامل): هم کامل بودن، هم معتبر بودنِ ساختاری کدها.
   * دادهٔ قدیمی با کد فیک/ناقص از گیت عبور نمی‌کند — پذیرش باید رکورد یکتا را تکمیل/اصلاح کند.
   */
  private assertPartyIdentity(party: Party): void {
    const problems: string[] = [];
    const legal = !!(party.natIdentifier || party.economicCode);
    if (party.nationality === 'FOREIGNER') {
      if (!party.idDocNo) problems.push('شماره شناسنامه/پاسپورت');
      if (!party.postalCode) problems.push('کد پستی (۱۰ رقم)');
    } else if (legal) {
      if (!party.natIdentifier) problems.push('شناسهٔ ملی (۱۱ رقم)');
      if (!party.economicCode) problems.push('کد اقتصادی (۱۱ تا ۱۴ رقم)');
    } else {
      if (!party.nationalId) problems.push('کد ملی (۱۰ رقم)');
      if (!party.postalCode) problems.push('کد پستی (۱۰ رقم)');
    }
    if (problems.length) {
      throw new ConflictException({
        code: 'IDENTITY_INCOMPLETE',
        message: `برای تبدیل رزرو به اقامت، تکمیل اطلاعات هویتی مهمان الزامی است: ${problems.join('، ')} — در فرم «ثبت مهمان» با تایپ نام/کد ملی، رکورد قبلی را از پیشنهادها بارگذاری کنید، اطلاعات را تکمیل و «ثبت تغییرات» را بزنید.`,
        details: { partyId: party.id, missing: problems },
      });
    }
    const invalid: string[] = [];
    if (party.nationalId && !mellicodeOk(party.nationalId)) invalid.push('کد ملی ثبت‌شده معتبر نیست (رقم کنترل غلط است)');
    if (party.natIdentifier && !legalIdOk(party.natIdentifier)) invalid.push('شناسهٔ ملی ثبت‌شده معتبر نیست (رقم کنترل غلط است)');
    if (party.postalCode && !/^\d{10}$/.test(party.postalCode)) invalid.push('کد پستی ثبت‌شده باید ۱۰ رقم باشد');
    if (invalid.length) {
      throw new ConflictException({
        code: 'IDENTITY_INVALID',
        message: `اطلاعات هویتی ثبت‌شده معتبر نیست: ${invalid.join('، ')} — رکورد قبلی را در فرم «ثبت مهمان» اصلاح کنید؛ کدهای فیک و دادهٔ قدیمیِ ناسازگار پذیرفته نمی‌شود.`,
        details: { partyId: party.id, invalid },
      });
    }
  }
}
