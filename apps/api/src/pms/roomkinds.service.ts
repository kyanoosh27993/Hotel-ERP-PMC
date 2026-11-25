/**
 * roomkinds.service.ts — نسخهٔ ۳٫۴: «لیست انواع اتاقها» و «اتاقها» طبق فرم‌های مرجع کارفرما
 * نرخ‌های ۴گانهٔ ریالی/دلاری + فصلی + فول برد + تخت اضافه + مشخصه‌های اضافی +
 * ستون‌های زندهٔ «تعداد اتاق / تعداد پر / تخت اضافه» با drill-down کلیک.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface RoomKindInput {
  code: string;
  nameFa: string;
  nameEn?: string;
  nameLatin?: string;
  capacity?: number;
  bedCount?: number;
  rateSingleRials?: string;
  rateDoubleRials?: string;
  rateTripleRials?: string;
  rateFullRials?: string;
  rateSingleUsd?: number;
  rateDoubleUsd?: number;
  rateTripleUsd?: number;
  rateFullUsd?: number;
  ratePeak1Rials?: string;
  ratePeak2Rials?: string;
  ratePeak3Rials?: string;
  fullBoardRials?: string;
  extraBedCount?: number;
  extraBedRials?: string;
  pictureUrl?: string;
  isActive?: boolean;
  syncCode?: number;
}

const RIAL_FIELDS = ['rateSingleRials', 'rateDoubleRials', 'rateTripleRials', 'rateFullRials', 'ratePeak1Rials', 'ratePeak2Rials', 'ratePeak3Rials', 'fullBoardRials', 'extraBedRials'] as const;

@Injectable()
export class RoomKindsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertRials(input: Record<string, unknown>) {
    for (const f of RIAL_FIELDS) {
      const v = input[f];
      if (v !== undefined && v !== null && !/^\d+$/.test(String(v))) {
        throw new BadRequestException({ code: 'VALIDATION', message: `${f} باید عدد صحیح ریالی باشد` });
      }
    }
  }

  /** لیست انواع اتاق — با سه ستون زندهٔ مرجع: تعداد اتاق، تعداد پر، تخت اضافه */
  async listKinds() {
    const kinds = await this.prisma.roomType.findMany({ orderBy: { code: 'asc' } });
    const totalByType = await this.prisma.room.groupBy({ by: ['roomTypeId'], _count: { _all: true } });
    const occupiedByType = await this.prisma.room.groupBy({
      by: ['roomTypeId'],
      _count: { _all: true },
      where: { status: 'OCCUPIED' },
    });
    const extraByType = await this.prisma.room.groupBy({ by: ['roomTypeId'], _sum: { extraBeds: true } });
    const totalMap = new Map(totalByType.map((g) => [g.roomTypeId, g._count._all]));
    const occMap = new Map(occupiedByType.map((g) => [g.roomTypeId, g._count._all]));
    const extraMap = new Map(extraByType.map((g) => [g.roomTypeId, g._sum.extraBeds ?? 0]));
    return kinds.map((k) => this.mapKind(k, {
      roomsCount: totalMap.get(k.id) ?? 0,
      occupiedCount: occMap.get(k.id) ?? 0,
      extraBedsCount: extraMap.get(k.id) ?? 0,
    }));
  }

  private mapKind(k: Record<string, unknown>, live: { roomsCount: number; occupiedCount: number; extraBedsCount: number }) {
    return {
      id: k.id as string,
      code: k.code as string,
      nameFa: k.nameFa as string,
      nameEn: k.nameEn as string,
      nameLatin: k.nameLatin as string | null,
      capacity: k.capacity as number,
      bedCount: k.bedCount as number,
      rateSingleRials: String(k.rateSingleRials ?? '0'),
      rateDoubleRials: String(k.rateDoubleRials ?? '0'),
      rateTripleRials: String(k.rateTripleRials ?? '0'),
      rateFullRials: String(k.rateFullRials ?? '0'),
      rateSingleUsd: k.rateSingleUsd as number,
      rateDoubleUsd: k.rateDoubleUsd as number,
      rateTripleUsd: k.rateTripleUsd as number,
      rateFullUsd: k.rateFullUsd as number,
      ratePeak1Rials: String(k.ratePeak1Rials ?? '0'),
      ratePeak2Rials: String(k.ratePeak2Rials ?? '0'),
      ratePeak3Rials: String(k.ratePeak3Rials ?? '0'),
      fullBoardRials: String(k.fullBoardRials ?? '0'),
      extraBedCount: k.extraBedCount as number,
      extraBedRials: String(k.extraBedRials ?? '0'),
      pictureUrl: k.pictureUrl as string | null,
      isActive: k.isActive as boolean,
      syncCode: k.syncCode as number,
      baseRateRials: String(k.baseRateRials ?? '0'),
      // ستون‌های زندهٔ مرجع
      roomsCount: live.roomsCount, // تعداد اتاق
      occupiedCount: live.occupiedCount, // تعداد پر — کلیک = لیست اتاق‌های اشغال‌شدهٔ این نوع
      extraBedsCount: live.extraBedsCount, // تخت اضافه — کلیک = لیست اتاق‌های دارای تخت اضافه
    };
  }

  async createKind(input: RoomKindInput) {
    this.assertRials(input as unknown as Record<string, unknown>);
    const dup = await this.prisma.roomType.findUnique({ where: { code: input.code } });
    if (dup) throw new ConflictException({ code: 'VALIDATION', message: `کد نوع اتاق «${input.code}» قبلاً ثبت شده است` });
    const kind = await this.prisma.roomType.create({
      data: {
        code: input.code,
        nameFa: input.nameFa,
        nameEn: input.nameEn ?? input.nameLatin ?? input.code,
        nameLatin: input.nameLatin ?? null,
        capacity: input.capacity ?? 2,
        bedCount: input.bedCount ?? 2,
        baseRateRials: BigInt(input.rateFullRials ?? input.rateSingleRials ?? '0'),
        rateSingleRials: BigInt(input.rateSingleRials ?? '0'),
        rateDoubleRials: BigInt(input.rateDoubleRials ?? '0'),
        rateTripleRials: BigInt(input.rateTripleRials ?? '0'),
        rateFullRials: BigInt(input.rateFullRials ?? '0'),
        rateSingleUsd: input.rateSingleUsd ?? 0,
        rateDoubleUsd: input.rateDoubleUsd ?? 0,
        rateTripleUsd: input.rateTripleUsd ?? 0,
        rateFullUsd: input.rateFullUsd ?? 0,
        ratePeak1Rials: BigInt(input.ratePeak1Rials ?? '0'),
        ratePeak2Rials: BigInt(input.ratePeak2Rials ?? '0'),
        ratePeak3Rials: BigInt(input.ratePeak3Rials ?? '0'),
        fullBoardRials: BigInt(input.fullBoardRials ?? '0'),
        extraBedCount: input.extraBedCount ?? 0,
        extraBedRials: BigInt(input.extraBedRials ?? '0'),
        pictureUrl: input.pictureUrl ?? null,
        isActive: input.isActive ?? true,
        syncCode: input.syncCode ?? 0,
      },
    });
    return this.mapKind(kind as unknown as Record<string, unknown>, { roomsCount: 0, occupiedCount: 0, extraBedsCount: 0 });
  }

  async updateKind(id: string, patch: Partial<RoomKindInput>) {
    this.assertRials(patch as unknown as Record<string, unknown>);
    const kind = await this.prisma.roomType.findUnique({ where: { id } });
    if (!kind) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نوع اتاق یافت نشد' });
    const data: Record<string, unknown> = {};
    const strFields: Array<[keyof RoomKindInput, string]> = [
      ['nameFa', 'nameFa'], ['nameEn', 'nameEn'], ['nameLatin', 'nameLatin'], ['pictureUrl', 'pictureUrl'],
    ];
    for (const [k, col] of strFields) {
      const v = patch[k];
      if (v !== undefined) data[col] = v === '' ? null : v;
    }
    if (patch.capacity !== undefined) {
      if (!Number.isInteger(patch.capacity) || patch.capacity < 1 || patch.capacity > 30) {
        throw new BadRequestException({ code: 'VALIDATION', message: 'ظرفیت باید عددی بین ۱ تا ۳۰ باشد' });
      }
      data.capacity = patch.capacity;
    }
    if (patch.bedCount !== undefined) {
      if (!Number.isInteger(patch.bedCount) || patch.bedCount < 0 || patch.bedCount > 30) {
        throw new BadRequestException({ code: 'VALIDATION', message: 'تعداد تخت باید عددی بین ۰ تا ۳۰ باشد' });
      }
      data.bedCount = patch.bedCount;
    }
    for (const f of RIAL_FIELDS) {
      const v = patch[f];
      if (v !== undefined) data[f] = BigInt(v as string);
    }
    for (const f of ['rateSingleUsd', 'rateDoubleUsd', 'rateTripleUsd', 'rateFullUsd'] as const) {
      if (patch[f] !== undefined) data[f] = patch[f];
    }
    if (patch.extraBedCount !== undefined) {
      if (!Number.isInteger(patch.extraBedCount) || patch.extraBedCount < 0 || patch.extraBedCount > 10) {
        throw new BadRequestException({ code: 'VALIDATION', message: 'تخت اضافه باید عددی بین ۰ تا ۱۰ باشد' });
      }
      data.extraBedCount = patch.extraBedCount;
    }
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.syncCode !== undefined) data.syncCode = patch.syncCode;
    const updated = await this.prisma.roomType.update({ where: { id }, data });
    const counts = await this.liveCounts(id);
    return this.mapKind(updated as unknown as Record<string, unknown>, counts);
  }

  private async liveCounts(roomTypeId: string) {
    const [total, occ, extra] = await Promise.all([
      this.prisma.room.count({ where: { roomTypeId } }),
      this.prisma.room.count({ where: { roomTypeId, status: 'OCCUPIED' } }),
      this.prisma.room.aggregate({ where: { roomTypeId }, _sum: { extraBeds: true } }),
    ]);
    return { roomsCount: total, occupiedCount: occ, extraBedsCount: extra._sum.extraBeds ?? 0 };
  }

  /** حذف نوع اتاق — اگر اتاق/رزرو وابسته داشته باشد ممنوع (قاعدهٔ مرجع) */
  async deleteKind(id: string) {
    const kind = await this.prisma.roomType.findUnique({
      where: { id },
      include: { _count: { select: { rooms: true, reservations: true } } },
    });
    if (!kind) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نوع اتاق یافت نشد' });
    if (kind._count.rooms > 0 || kind._count.reservations > 0) {
      throw new ConflictException({
        code: 'BUSINESS_RULE',
        message: `این نوع ${kind._count.rooms} اتاق و ${kind._count.reservations} رزرو دارد — ابتدا وابستگی‌ها را منتقل کنید`,
      });
    }
    await this.prisma.roomType.delete({ where: { id } });
    return { deleted: true, code: kind.code };
  }

  /** drill-down ستون‌های زنده: اتاق‌های یک نوع — occupiedOnly برای «تعداد پر»، extraBeds برای «تخت اضافه» */
  async kindRooms(kindId: string, opts: { occupiedOnly?: boolean; extraBedsOnly?: boolean }) {
    const kind = await this.prisma.roomType.findUnique({ where: { id: kindId } });
    if (!kind) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نوع اتاق یافت نشد' });
    const where: Record<string, unknown> = { roomTypeId: kindId };
    if (opts.occupiedOnly) where.status = 'OCCUPIED';
    if (opts.extraBedsOnly) where.extraBeds = { gt: 0 };
    const rooms = await this.prisma.room.findMany({
      where,
      orderBy: [{ floor: 'asc' }, { code: 'asc' }],
      include: {
        stayRooms: { where: { stay: { status: 'OPEN' } }, include: { stay: true }, orderBy: { id: 'asc' } },
      },
    });
    return {
      kind: { id: kind.id, code: kind.code, nameFa: kind.nameFa, nameLatin: kind.nameLatin },
      rooms: rooms.map((r) => {
        const openStay = r.stayRooms[0]?.stay ?? null;
        return {
          id: r.id,
          code: r.code,
          floor: r.floor,
          orderInFloor: r.orderInFloor,
          bedCount: r.bedCount,
          extraBeds: r.extraBeds, // تخت اضافهٔ داده‌شده به این اتاق
          status: r.status,
          hkStatus: r.hkStatus,
          nameFa: r.nameFa,
          nameLatin: r.nameLatin,
          note: r.note,
          lastChargeAt: r.lastChargeAt,
          tourCompany: r.tourCompany,
          rateFullRials: String(r.rateFullRials || kind.rateFullRials),
          guestName: openStay?.guestName ?? null,
          checkInDate: openStay ? openStay.checkInAt.toISOString().slice(0, 10) : null,
          checkOutDate: openStay ? openStay.plannedCheckOut.toISOString().slice(0, 10) : null,
        };
      }),
    };
  }

  /** فهرست مدیریتی اتاق‌ها (فرم «اتاقها» مرجع) — همهٔ فیلدها + مشخصه‌ها */
  async roomsAdmin() {
    const rooms = await this.prisma.room.findMany({
      orderBy: [{ floor: 'asc' }, { code: 'asc' }],
      include: {
        roomType: { select: { code: true, nameFa: true, nameLatin: true } },
        amenities: { include: { amenity: true } },
      },
    });
    return rooms.map((r) => ({
      id: r.id,
      code: r.code,
      roomTypeId: r.roomTypeId,
      roomTypeFa: r.roomType.nameFa,
      nameFa: r.nameFa,
      nameLatin: r.nameLatin,
      bedCount: r.bedCount,
      orderInFloor: r.orderInFloor,
      extraBeds: r.extraBeds,
      floor: r.floor,
      status: r.status,
      hkStatus: r.hkStatus,
      rateSingleRials: String(r.rateSingleRials),
      rateDoubleRials: String(r.rateDoubleRials),
      rateTripleRials: String(r.rateTripleRials),
      rateFullRials: String(r.rateFullRials),
      rateSingleUsd: r.rateSingleUsd,
      rateDoubleUsd: r.rateDoubleUsd,
      rateTripleUsd: r.rateTripleUsd,
      rateFullUsd: r.rateFullUsd,
      saleBlocked: r.saleBlocked,
      guestRequests: r.guestRequests,
      registerNo: r.registerNo,
      lastChargeAt: r.lastChargeAt,
      outOfServiceFrom: r.outOfServiceFrom,
      outOfServiceCancelAt: r.outOfServiceCancelAt,
      blockCard: r.blockCard,
      tourCompany: r.tourCompany,
      note: r.note,
      amenityIds: r.amenities.map((l) => l.amenityId),
    }));
  }

  /* ── مشخصه‌های اضافی اتاق ── */

  async listAmenities() {
    const rows = await this.prisma.roomAmenity.findMany({ orderBy: { code: 'asc' }, include: { _count: { select: { rooms: true } } } });
    return rows.map((a) => ({
      id: a.id,
      code: a.code,
      nameFa: a.nameFa,
      nameLatin: a.nameLatin,
      shortName: a.shortName,
      isActive: a.isActive,
      roomsCount: a._count.rooms,
    }));
  }

  async createAmenity(input: { code: string; nameFa: string; nameLatin?: string; shortName?: string }) {
    const dup = await this.prisma.roomAmenity.findUnique({ where: { code: input.code } });
    if (dup) throw new ConflictException({ code: 'VALIDATION', message: `کد مشخصه «${input.code}» قبلاً ثبت شده است` });
    const a = await this.prisma.roomAmenity.create({
      data: { code: input.code, nameFa: input.nameFa, nameLatin: input.nameLatin ?? null, shortName: input.shortName ?? null },
    });
    return { id: a.id, code: a.code, nameFa: a.nameFa, nameLatin: a.nameLatin, shortName: a.shortName, isActive: a.isActive, roomsCount: 0 };
  }

  async updateAmenity(id: string, patch: { nameFa?: string; nameLatin?: string; shortName?: string; isActive?: boolean }) {
    const a = await this.prisma.roomAmenity.findUnique({ where: { id } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'مشخصه یافت نشد' });
    const data: Record<string, unknown> = {};
    if (patch.nameFa !== undefined) data.nameFa = patch.nameFa;
    if (patch.nameLatin !== undefined) data.nameLatin = patch.nameLatin || null;
    if (patch.shortName !== undefined) data.shortName = patch.shortName || null;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    const u = await this.prisma.roomAmenity.update({ where: { id }, data });
    return { id: u.id, code: u.code, nameFa: u.nameFa, nameLatin: u.nameLatin, shortName: u.shortName, isActive: u.isActive };
  }

  async deleteAmenity(id: string) {
    const a = await this.prisma.roomAmenity.findUnique({ where: { id }, include: { _count: { select: { rooms: true } } } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'مشخصه یافت نشد' });
    if (a._count.rooms > 0) {
      throw new ConflictException({ code: 'BUSINESS_RULE', message: `این مشخصه به ${a._count.rooms} اتاق متصل است` });
    }
    await this.prisma.roomAmenity.delete({ where: { id } });
    return { deleted: true, code: a.code };
  }
}
