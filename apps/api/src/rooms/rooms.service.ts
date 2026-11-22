/**
 * rooms.service.ts — فاز ۴ (F4-T1): نقشه اتاق و تغییر وضعیت لحظه‌ای + کارت تعمیرات.
 * قواعد: OCCUPIED فقط از مسیر چک‌این؛ اتاق اشغال‌شده را نمی‌توان دستی آزاد کرد.
 * هر تغییر وضعیت در لاگ حسابرسی ثبت می‌شود.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RoomStatus } from '@prisma/client';

const MANUAL_STATUSES: RoomStatus[] = ['AVAILABLE', 'DIRTY', 'OUT_OF_SERVICE'];

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  /** فهرست اتاق‌ها با فیلتر وضعیت/طبقه/نوع — مبنای نقشه اتاق */
  async list(filters: { status?: string; floor?: number; roomTypeId?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.floor) where.floor = filters.floor;
    if (filters.roomTypeId) where.roomTypeId = filters.roomTypeId;
    const rooms = await this.prisma.room.findMany({
      where,
      orderBy: [{ floor: 'asc' }, { code: 'asc' }],
      include: { roomType: { select: { code: true, nameFa: true } } },
    });
    return rooms.map((r) => ({
      id: r.id,
      code: r.code,
      floor: r.floor,
      status: r.status,
      note: r.note,
      roomTypeCode: r.roomType.code,
      roomTypeFa: r.roomType.nameFa,
    }));
  }

  /** تغییر وضعیت لحظه‌ای (AVAILABLE/DIRTY/OUT_OF_SERVICE) با دلیل و حسابرسی */
  async changeStatus(
    roomId: string,
    status: string,
    note: string | undefined,
    userId: string | null,
  ) {
    if (!MANUAL_STATUSES.includes(status as RoomStatus)) {
      throw new BadRequestException({
        code: 'VALIDATION',
        message: 'وضعیت دستی فقط AVAILABLE/DIRTY/OUT_OF_SERVICE است؛ OCCUPIED فقط از مسیر چک‌این',
      });
    }
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Room not found' });

    const activeStay = await this.prisma.reservation.findFirst({
      where: { roomId, status: 'CHECKED_IN' },
    });
    if (activeStay && status !== room.status) {
      throw new ConflictException({
        code: 'BUSINESS_RULE',
        message: `اتاق ${room.code} مهمان فعال دارد (${activeStay.code}) — ابتدا چک‌اوت`,
      });
    }
    if (status === 'OUT_OF_SERVICE' && !note) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'برای خارج از سرویس، دلیل (تعمیرات) الزامی است' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.room.update({ where: { id: roomId }, data: { status: status as RoomStatus, note: note ?? null } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ROOM_STATUS_CHANGED',
          entity: 'Room',
          entityId: r.id,
          beforeJson: { status: room.status, note: room.note },
          afterJson: { status: r.status, note: r.note },
        },
      });
      return r;
    });
    return { id: updated.id, code: updated.code, status: updated.status, note: updated.note };
  }
}
