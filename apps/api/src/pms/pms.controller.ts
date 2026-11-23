/**
 * pms.controller.ts — فاز ۴: نقشه اتاق، رزرو توسعه‌یافته، لیست انتظار، پذیرش، خانه‌داری، حسابرسی شبانه.
 * همه مسیرها نسخه‌دار: /api/v1/pms/... و با مجوز RBAC محافظت شده‌اند.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RequirePermissions, RequireAnyPermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { PmsService, CheckInInput, PmsReservationInput } from './pms.service';
import { AuthenticatedRequest } from '../common/authenticated.request';

export class UpdateRoomDto {
  @IsOptional()
  @IsIn(['AVAILABLE', 'OCCUPIED', 'DIRTY', 'OUT_OF_SERVICE'])
  status!: string;

  @IsOptional()
  @IsIn(['CLEAN', 'DIRTY', 'IN_PROGRESS', 'INSPECTED'])
  hkStatus!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note!: string | null;
}

export class PmsReservationDto {
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

  @IsOptional()
  @IsIn(['PHONE', 'WALK_IN', 'ONLINE', 'OTA'])
  source!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupName!: string;

  @IsOptional()
  @IsNumber()
  adults!: number;

  @IsOptional()
  @IsNumber()
  children!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note!: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'rateOverrideRials must be integer digits (Rials)' })
  rateOverrideRials!: string;
}

export class WaitlistDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  guestName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsString()
  @MaxLength(64)
  roomTypeId!: string;

  @IsString()
  fromDate!: string; // YYYY-MM-DD

  @IsString()
  toDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note!: string;
}

export class WaitlistPatchDto {
  @IsIn(['WAITING', 'OFFERED', 'BOOKED', 'CANCELLED'])
  status!: string;
}

export class CheckInDto {
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  reservationId!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  guestName!: string;

  @IsArray()
  @IsString({ each: true })
  roomIds!: string[];

  @IsString()
  plannedCheckOut!: string; // YYYY-MM-DD

  @IsOptional()
  @IsNumber()
  adults!: number;

  @IsOptional()
  @IsNumber()
  children!: number;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'rateOverrideRials must be integer digits (Rials)' })
  rateOverrideRials!: string;
}

export class NightAuditDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'businessDate must be YYYY-MM-DD' })
  businessDate!: string;
}

@ApiTags('pms')
@ApiBearerAuth()
@Controller('pms')
export class PmsController {
  constructor(private readonly pms: PmsService) {}

  // ── F4-T1 نقشه اتاق ──
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('rooms/map')
  async roomsMap() {
    return { data: await this.pms.roomsMap() };
  }

  // پذیرش/خانه‌داری هر دو می‌توانند وضعیت اتاق را تغییر دهند (یکی از دو مجوز)
  @RequireAnyPermissions(PERMISSIONS.ROOM_UPDATE, PERMISSIONS.HOUSEKEEPING_UPDATE)
  @Patch('rooms/:id')
  async updateRoom(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return { data: await this.pms.updateRoom(id, { status: dto.status, hkStatus: dto.hkStatus, note: dto.note }) };
  }

  // ── F4-T2 رزرواسیون توسعه‌یافته ──
  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('reservations')
  async createReservation(@Body() dto: PmsReservationDto, @Req() req: AuthenticatedRequest) {
    const input: PmsReservationInput = {
      roomTypeId: dto.roomTypeId,
      guestName: dto.guestName,
      checkInDate: dto.checkInDate,
      checkOutDate: dto.checkOutDate,
      idempotencyKey: dto.idempotencyKey,
      createdByUserId: req.user.id,
      source: dto.source as PmsReservationInput['source'],
      groupName: dto.groupName,
      adults: dto.adults,
      children: dto.children,
      note: dto.note,
      rateOverrideRials: dto.rateOverrideRials,
    };
    return { data: await this.pms.createReservation(input) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('reservations/:id/cancel')
  async cancelReservation(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return { data: await this.pms.cancelReservation(id, req.user.id) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('reservations')
  async listReservations(
    @Query('status') status?: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.pms.listReservations({ status, date }) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('waitlist')
  async createWaitlist(@Body() dto: WaitlistDto, @Req() req: AuthenticatedRequest) {
    return { data: await this.pms.createWaitlist({ ...dto, createdByUserId: req.user.id }) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('waitlist')
  async listWaitlist() {
    return { data: await this.pms.listWaitlist() };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Patch('waitlist/:id')
  async updateWaitlist(@Param('id') id: string, @Body() dto: WaitlistPatchDto) {
    return { data: await this.pms.updateWaitlist(id, dto.status) };
  }

  // ── F4-T3 پذیرش ──
  @RequirePermissions(PERMISSIONS.STAY_CHECKIN)
  @Post('stays/check-in')
  async checkIn(@Body() dto: CheckInDto, @Req() req: AuthenticatedRequest) {
    const input: CheckInInput = {
      idempotencyKey: dto.idempotencyKey,
      createdByUserId: req.user.id,
      reservationId: dto.reservationId,
      guestName: dto.guestName,
      roomIds: Array.isArray(dto.roomIds) ? dto.roomIds.map(String) : [],
      plannedCheckOut: dto.plannedCheckOut,
      adults: dto.adults,
      children: dto.children,
      rateOverrideRials: dto.rateOverrideRials,
    };
    return { data: await this.pms.checkIn(input) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('stays')
  async listStays() {
    return { data: await this.pms.listStays() };
  }

  @RequirePermissions(PERMISSIONS.STAY_CHECKOUT)
  @Post('stays/:id/check-out')
  async checkOut(@Param('id') id: string) {
    return { data: await this.pms.checkOut(id) };
  }

  // ── F4-T8 حسابرسی شبانه ──
  @RequirePermissions(PERMISSIONS.NIGHT_AUDIT_RUN)
  @Post('night-audit')
  async nightAudit(@Body() dto: NightAuditDto, @Req() req: AuthenticatedRequest) {
    return { data: await this.pms.nightAudit(dto.businessDate, req.user.id) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('night-audit')
  async listNightAudits() {
    return { data: await this.pms.listNightAudits() };
  }
}
