/**
 * pms.service.ts — فاز ۴ (F4-T1…T3 + T7 + T8): نقشه اتاق، رزرواسیون توسعه‌یافته،
 * لیست انتظار، پذیرش (ورود/خروج اقامت چنداتاقه)، خانه‌داری پایه، حسابرسی شبانه.
 * قواعد: پول فقط BigInt ریال؛ کنترل هم‌زمانی با قفل مشورتی؛ رویدادها با Outbox هم‌تراکنشی.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import { mulRial } from '@hotel-erp/shared';
import { ReservationService } from '../reservations/reservation.service';
import { nextDocSeq } from '../common/doc-seq';

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
  rateOverrideRials?: string; // ارقام — نرخ توافقی (گروهی)
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
  async updateRoom(roomId: string, patch: { status?: string; hkStatus?: string; note?: string | null }) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room not found' });

    const data: { status?: 'AVAILABLE' | 'OCCUPIED' | 'DIRTY' | 'OUT_OF_SERVICE'; hkStatus?: 'CLEAN' | 'DIRTY' | 'IN_PROGRESS' | 'INSPECTED'; note?: string | null } = {};

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

    const updated = await this.prisma.room.update({ where: { id: roomId }, data });
    return { id: updated.id, code: updated.code, status: updated.status, hkStatus: updated.hkStatus, note: updated.note };
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

  async listReservations(filter: { status?: string; date?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.date) where.checkIn = new Date(`${filter.date}T00:00:00Z`);
    const rows = await this.prisma.reservation.findMany({
      where,
      include: { roomType: { select: { code: true, nameFa: true } } },
      orderBy: [{ checkIn: 'desc' }, { code: 'asc' }],
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      guestName: r.guestName,
      roomType: r.roomType.code,
      checkIn: r.checkIn.toISOString().slice(0, 10),
      checkOut: r.checkOut.toISOString().slice(0, 10),
      nights: r.nights,
      totalRials: r.totalRials.toString(),
      status: r.status,
      source: r.source,
      groupName: r.groupName,
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

      const seq = await nextDocSeq(tx, 'stay');
      const code = `STY-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
      const guestName = reservation?.guestName ?? input.guestName ?? '';
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
          rooms: {
            create: rooms.map((r) => ({
              roomId: r.id,
              rateOverrideRials: input.rateOverrideRials ? BigInt(input.rateOverrideRials) : null,
            })),
          },
        },
        include: { rooms: { include: { room: true } } },
      });

      await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status: 'OCCUPIED' } });
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
      let folio = 0n;
      const roomCodes: string[] = [];
      for (const sr of stay.rooms) {
        const nightly = sr.rateOverrideRials ?? sr.room.roomType.baseRateRials;
        folio += nightly * BigInt(nights);
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
}
