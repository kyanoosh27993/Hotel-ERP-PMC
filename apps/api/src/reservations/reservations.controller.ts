import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { ReservationService, ReservationSource, RESERVATION_SOURCES } from './reservation.service';
import { PrismaService } from '../prisma.service';
import { AuthenticatedRequest } from '../common/authenticated.request';

export class ConfirmReservationDto {
  @IsString()
  @MaxLength(64)
  roomTypeId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  guestName!: string;

  @IsString()
  checkInDate!: string; // YYYY-MM-DD

  @IsString()
  checkOutDate!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  /** رزرو گروهی: تعداد واحد از همین نوع (پیش‌فرض ۱) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  units?: number;

  /** کانال ثبت: تلفنی/حضوری/آنلاین/OTA */
  @IsOptional()
  @IsIn(RESERVATION_SOURCES)
  source?: string;

  /** تعرفه ویژه شبانه (ریال، رشته‌ای برای دقت BigInt) — خالی = نرخ پایه */
  @IsOptional()
  @IsString()
  ratePerNightRials?: string;
}

export class WaitlistDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  guestName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MaxLength(64)
  roomTypeId!: string;

  @IsString()
  fromDate!: string;

  @IsString()
  toDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  units?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

@ApiTags('reservations')
@ApiBearerAuth()
@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationService, private readonly prisma: PrismaService) {}

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('reservations')
  async confirm(@Body() dto: ConfirmReservationDto, @Req() req: AuthenticatedRequest) {
    const result = await this.reservations.confirm({
      roomTypeId: dto.roomTypeId,
      guestName: dto.guestName,
      checkInDate: dto.checkInDate,
      checkOutDate: dto.checkOutDate,
      idempotencyKey: dto.idempotencyKey,
      createdByUserId: req.user.id,
      units: dto.units,
      source: dto.source as ReservationSource | undefined,
      ratePerNightRials: dto.ratePerNightRials,
    });
    return { data: result };
  }

  /** F4-T3 — چک‌این پذیرش با تخصیص خودکار اتاق */
  @RequirePermissions(PERMISSIONS.ROOM_MANAGE)
  @Post('reservations/:id/check-in')
  async checkIn(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.reservations.checkIn(id, req.user.id) };
  }

  /** F4-T3 — چک‌اوت؛ اتاق به وضعیت نظافت می‌رود */
  @RequirePermissions(PERMISSIONS.ROOM_MANAGE)
  @Post('reservations/:id/check-out')
  async checkOut(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.reservations.checkOut(id, req.user.id) };
  }

  /** F4-T2 — لیست انتظار */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('waiting-list')
  async waitlistList() {
    return { data: await this.reservations.waitlistList() };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('waiting-list')
  async waitlistAdd(@Body() dto: WaitlistDto) {
    return { data: await this.reservations.waitlistAdd(dto) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('waiting-list/:id/convert')
  async waitlistConvert(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.reservations.waitlistConvert(id, req.user.id) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Patch('waiting-list/:id/cancel')
  async waitlistCancel(@Param('id') id: string) {
    return { data: await this.reservations.waitlistCancel(id) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('room-types')
  async roomTypes() {
    const rows = await this.prisma.roomType.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, nameEn: true, nameFa: true, capacity: true, baseRateRials: true },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        code: r.code,
        nameEn: r.nameEn,
        nameFa: r.nameFa,
        capacity: r.capacity,
        baseRateRials: r.baseRateRials.toString(),
      })),
    };
  }
}
