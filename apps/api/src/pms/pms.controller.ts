/**
 * pms.controller.ts — فاز ۴: نقشه اتاق، رزرو توسعه‌یافته، لیست انتظار، پذیرش، خانه‌داری، حسابرسی شبانه.
 * همه مسیرها نسخه‌دار: /api/v1/pms/... و با مجوز RBAC محافظت شده‌اند.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RequirePermissions, RequireAnyPermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { PmsService, CheckInInput, PmsReservationInput } from './pms.service';
import { RoomKindsService, RoomKindInput } from './roomkinds.service';
import { PlansService } from './plans.service';
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

  // تنظیم اتاق (درخواست کارفرما)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsOptional()
  @IsNumber()
  floor!: number;

  @IsOptional()
  @IsString()
  roomTypeId!: string;

  // فرم «تصحیح مشخصات اتاق» (نسخهٔ ۳٫۴)
  @IsOptional() @IsString() @MaxLength(60) nameFa!: string | null;
  @IsOptional() @IsString() @MaxLength(60) nameLatin!: string | null;
  @IsOptional() @IsNumber() bedCount!: number;
  @IsOptional() @IsNumber() orderInFloor!: number;
  @IsOptional() @IsNumber() extraBeds!: number;
  @IsOptional() @Matches(/^\d+$/) rateSingleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateDoubleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateTripleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateFullRials!: string;
  @IsOptional() @IsNumber() rateSingleUsd!: number;
  @IsOptional() @IsNumber() rateDoubleUsd!: number;
  @IsOptional() @IsNumber() rateTripleUsd!: number;
  @IsOptional() @IsNumber() rateFullUsd!: number;
  @IsOptional() @IsBoolean() saleBlocked!: boolean;
  @IsOptional() @IsNumber() guestRequests!: number;
  @IsOptional() @IsNumber() registerNo!: number | null;
  @IsOptional() @IsString() lastChargeAt!: string | null;
  @IsOptional() @IsString() outOfServiceFrom!: string | null;
  @IsOptional() @IsString() outOfServiceCancelAt!: string | null;
  @IsOptional() @IsString() @MaxLength(80) blockCard!: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) amenityIds!: string[];
}

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsNumber()
  floor!: number;

  @IsString()
  roomTypeId!: string;

  // فرم «ثبت اتاق جدید» (نسخهٔ ۳٫۴)
  @IsOptional() @IsString() @MaxLength(60) nameFa!: string;
  @IsOptional() @IsString() @MaxLength(60) nameLatin!: string;
  @IsOptional() @IsNumber() bedCount!: number;
  @IsOptional() @IsNumber() orderInFloor!: number;
  @IsOptional() @IsNumber() extraBeds!: number;
  @IsOptional() @Matches(/^\d+$/) rateSingleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateDoubleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateTripleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateFullRials!: string;
  @IsOptional() @IsNumber() rateSingleUsd!: number;
  @IsOptional() @IsNumber() rateDoubleUsd!: number;
  @IsOptional() @IsNumber() rateTripleUsd!: number;
  @IsOptional() @IsNumber() rateFullUsd!: number;
  @IsOptional() @IsString() @MaxLength(240) note!: string;
  @IsOptional() @IsNumber() registerNo!: number;
  @IsOptional() @IsBoolean() saleBlocked!: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) amenityIds!: string[];
}

export class CreateRoomTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameFa!: string;

  @IsOptional()
  @IsNumber()
  capacity!: number;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'baseRateRials must be integer digits (Rials)' })
  baseRateRials!: string;

  // ── فرم کامل «انواع اتاق» (نسخهٔ ۳٫۴) ──
  @IsOptional() @IsString() @MaxLength(60) nameLatin!: string;
  @IsOptional() @IsNumber() bedCount!: number;
  @IsOptional() @Matches(/^\d+$/) rateSingleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateDoubleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateTripleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateFullRials!: string;
  @IsOptional() @IsNumber() rateSingleUsd!: number;
  @IsOptional() @IsNumber() rateDoubleUsd!: number;
  @IsOptional() @IsNumber() rateTripleUsd!: number;
  @IsOptional() @IsNumber() rateFullUsd!: number;
  @IsOptional() @Matches(/^\d+$/) ratePeak1Rials!: string;
  @IsOptional() @Matches(/^\d+$/) ratePeak2Rials!: string;
  @IsOptional() @Matches(/^\d+$/) ratePeak3Rials!: string;
  @IsOptional() @Matches(/^\d+$/) fullBoardRials!: string;
  @IsOptional() @IsNumber() extraBedCount!: number;
  @IsOptional() @Matches(/^\d+$/) extraBedRials!: string;
  @IsOptional() @IsString() @MaxLength(240) pictureUrl!: string;
  @IsOptional() @IsBoolean() isActive!: boolean;
  @IsOptional() @IsNumber() syncCode!: number;
}

export class UpdateRoomTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameFa!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nameEn!: string;

  @IsOptional()
  @IsNumber()
  capacity!: number;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'baseRateRials must be integer digits (Rials)' })
  baseRateRials!: string;

  @IsOptional() @IsString() @MaxLength(60) nameLatin!: string;
  @IsOptional() @IsNumber() bedCount!: number;
  @IsOptional() @Matches(/^\d+$/) rateSingleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateDoubleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateTripleRials!: string;
  @IsOptional() @Matches(/^\d+$/) rateFullRials!: string;
  @IsOptional() @IsNumber() rateSingleUsd!: number;
  @IsOptional() @IsNumber() rateDoubleUsd!: number;
  @IsOptional() @IsNumber() rateTripleUsd!: number;
  @IsOptional() @IsNumber() rateFullUsd!: number;
  @IsOptional() @Matches(/^\d+$/) ratePeak1Rials!: string;
  @IsOptional() @Matches(/^\d+$/) ratePeak2Rials!: string;
  @IsOptional() @Matches(/^\d+$/) ratePeak3Rials!: string;
  @IsOptional() @Matches(/^\d+$/) fullBoardRials!: string;
  @IsOptional() @IsNumber() extraBedCount!: number;
  @IsOptional() @Matches(/^\d+$/) extraBedRials!: string;
  @IsOptional() @IsString() @MaxLength(240) pictureUrl!: string;
  @IsOptional() @IsBoolean() isActive!: boolean;
  @IsOptional() @IsNumber() syncCode!: number;
}

export class FolioItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  desc!: string;

  @IsNumber()
  qty!: number;

  @Matches(/^\d+$/, { message: 'unitRials must be integer digits (Rials)' })
  unitRials!: string;

  /** نسخهٔ ۳٫۴ — کد درآمدی قلم؛ مسیر صورت‌حساب (مهمان/شرکت) از پلان اقامت تعیین می‌شود */
  @IsOptional()
  @IsString()
  revenueCodeId!: string;
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

  @IsOptional()
  @IsIn(['IRANIAN', 'FOREIGNER'])
  nationality!: 'IRANIAN' | 'FOREIGNER';

  @IsOptional()
  @IsString()
  partyId!: string; // پیوند با ثبت یکتای اشخاص (نیاز یکتایی کارفرما)

  /** نسخهٔ ۳٫۴ — پلان تور/شرکت */
  @IsOptional()
  @IsString()
  planId!: string;
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

  @IsOptional()
  @IsString()
  partyId!: string; // رکورد یکتای مهمان — الزامی در گیت هویتی سخت‌گیرانه

  /** نسخهٔ ۳٫۴ — پلان اقامت؛ پیش‌فرض پلان رزرو مبدأ */
  @IsOptional()
  @IsString()
  planId!: string;
}

export class AttachPartyDto {
  @IsString()
  partyId!: string; // اتصال رکورد یکتا به رزرو (قدیمی/جدید)
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
  constructor(private readonly pms: PmsService, private readonly kinds: RoomKindsService, private readonly plans: PlansService) {}

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
    return { data: await this.pms.updateRoom(id, { ...dto }) };
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
      nationality: dto.nationality,
      partyId: dto.partyId,
      planId: dto.planId,
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
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('nationality') nationality?: string,
  ) {
    return { data: await this.pms.listReservations({ status, date, from, to, nationality }) };
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
      partyId: dto.partyId,
      planId: dto.planId,
    };
    return { data: await this.pms.checkIn(input) };
  }

  /** اتصال رکورد یکتای مهمان به رزرو — الزام کارفرما: رزروهای قدیمی هم باید رکورد با کد معتبر داشته باشند */
  @RequirePermissions(PERMISSIONS.STAY_CHECKIN)
  @Post('reservations/:id/party')
  async attachParty(@Param('id') id: string, @Body() dto: AttachPartyDto) {
    return { data: await this.pms.attachParty(id, dto.partyId) };
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

  // ───────── تنظیمات اتاق‌ها (درخواست کارفرما) ─────────

  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('room-types')
  async listRoomTypes() {
    return { data: await this.pms.listRoomTypes() };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Post('room-types')
  async createRoomType(@Body() dto: CreateRoomTypeDto) {
    const kindInput: RoomKindInput = { ...dto };
    return { data: await this.kinds.createKind(kindInput) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Patch('room-types/:id')
  async updateRoomType(@Param('id') id: string, @Body() dto: UpdateRoomTypeDto) {
    return { data: await this.kinds.updateKind(id, dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Post('rooms')
  async createRoom(@Body() dto: CreateRoomDto) {
    return { data: await this.pms.createRoom(dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Delete('rooms/:id')
  async deleteRoom(@Param('id') id: string) {
    return { data: await this.pms.deleteRoom(id) };
  }

  // ───────── فولیو — اقلام اضافی و صورتحساب‌های باز (مرجع 4.zip) ─────────

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post('stays/:id/folio-items')
  async addFolioItem(@Param('id') stayId: string, @Body() dto: FolioItemDto, @Req() req: AuthenticatedRequest) {
    return { data: await this.pms.addFolioItem(stayId, { desc: dto.desc, qty: dto.qty, unitRials: dto.unitRials, createdByUserId: req.user.id, revenueCodeId: dto.revenueCodeId }) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('stays/:id/folio-items')
  async listFolioItems(@Param('id') stayId: string) {
    return { data: await this.pms.listFolioItems(stayId) };
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('folios/open')
  async openFolios() {
    return { data: await this.pms.openFolios() };
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

  // ───────── نسخهٔ ۳٫۴ — انواع اتاق، مشخصه‌های اضافی، پلان تور/شرکت ─────────

  /** لیست انواع اتاق — با ستون‌های زندهٔ تعداد اتاق/تعداد پر/تخت اضافه */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('room-kinds')
  async listRoomKinds() {
    return { data: await this.kinds.listKinds() };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Delete('room-kinds/:id')
  async deleteRoomKind(@Param('id') id: string) {
    return { data: await this.kinds.deleteKind(id) };
  }

  /** فهرست مدیریتی اتاق‌ها (فرم «اتاقها») */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('rooms-admin')
  async roomsAdmin() {
    return { data: await this.kinds.roomsAdmin() };
  }

  /** drill-down ستون‌های زنده: اتاق‌های نوع — ?occupied=1 برای «تعداد پر» و ?extraBeds=1 برای «تخت اضافه» */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('room-kinds/:id/rooms')
  async roomKindRooms(@Param('id') id: string, @Query('occupied') occupied?: string, @Query('extraBeds') extraBeds?: string) {
    return { data: await this.kinds.kindRooms(id, { occupiedOnly: occupied === '1', extraBedsOnly: extraBeds === '1' }) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('room-amenities')
  async listRoomAmenities() {
    return { data: await this.kinds.listAmenities() };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Post('room-amenities')
  async createRoomAmenity(@Body() dto: { code: string; nameFa: string; nameLatin?: string; shortName?: string }) {
    return { data: await this.kinds.createAmenity(dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Patch('room-amenities/:id')
  async updateRoomAmenity(@Param('id') id: string, @Body() dto: { nameFa?: string; nameLatin?: string; shortName?: string; isActive?: boolean }) {
    return { data: await this.kinds.updateAmenity(id, dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Delete('room-amenities/:id')
  async deleteRoomAmenity(@Param('id') id: string) {
    return { data: await this.kinds.deleteAmenity(id) };
  }

  /** لیست انواع پلانی هتل */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('plans')
  async listPlans() {
    return { data: await this.plans.listPlans() };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Post('plans')
  async createPlan(@Body() dto: { code?: number; nameFa: string; nameLatin?: string; isActive?: boolean }, @Req() req: AuthenticatedRequest) {
    return { data: await this.plans.createPlan({ ...dto, createdById: req.user.id }) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() dto: { nameFa?: string; nameLatin?: string; isActive?: boolean }) {
    return { data: await this.plans.updatePlan(id, dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Delete('plans/:id')
  async deletePlan(@Param('id') id: string) {
    return { data: await this.plans.deletePlan(id) };
  }

  /** جزئيات پلان — ریز اقلام با سهم میهمان/شرکت + «نمایش تفکیکی پلان» */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('plans/:id/items')
  async listPlanItems(@Param('id') id: string) {
    return { data: await this.plans.listPlanItems(id) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Post('plans/:id/items')
  async addPlanItem(@Param('id') id: string, @Body() dto: { revenueCodeId: string; chargeTo?: string }, @Req() req: AuthenticatedRequest) {
    return { data: await this.plans.addPlanItem(id, { ...dto, createdById: req.user.id }) };
  }

  /** تصحیح کدینگ درآمدی پلان — تغییر سهم قلم (میهمان ↔ تور/شرکت) */
  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Patch('plan-items/:id')
  async updatePlanItem(@Param('id') id: string, @Body() dto: { chargeTo?: string }) {
    return { data: await this.plans.updatePlanItem(id, dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Delete('plan-items/:id')
  async deletePlanItem(@Param('id') id: string) {
    return { data: await this.plans.deletePlanItem(id) };
  }

  /** دیکشنری کدینگ درآمدی */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('revenue-codes')
  async listRevenueCodes() {
    return { data: await this.plans.listRevenueCodes() };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Post('revenue-codes')
  async createRevenueCode(@Body() dto: { code?: number; nameFa: string; nameEn?: string }) {
    return { data: await this.plans.createRevenueCode(dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Patch('revenue-codes/:id')
  async updateRevenueCode(@Param('id') id: string, @Body() dto: { nameFa?: string; nameEn?: string; isActive?: boolean }) {
    return { data: await this.plans.updateRevenueCode(id, dto) };
  }

  @RequirePermissions(PERMISSIONS.ROOM_UPDATE)
  @Delete('revenue-codes/:id')
  async deleteRevenueCode(@Param('id') id: string) {
    return { data: await this.plans.deleteRevenueCode(id) };
  }

  /** تفکیک فولیو اقامت به دو صورت‌حساب: میهمان و تور/شرکت */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get('stays/:id/folio-split')
  async folioSplit(@Param('id') id: string) {
    return { data: await this.plans.folioSplit(id) };
  }

  /** صدور فاکتور رسمی به نام میهمان یا تور/شرکت (پیش‌نویس مؤدیان — ارسال از مسیر موجود compliance) */
  @RequireAnyPermissions(PERMISSIONS.ROOM_UPDATE, PERMISSIONS.INVOICE_MANAGE)
  @Post('stays/:id/invoice')
  async issueStayInvoice(@Param('id') id: string, @Body() dto: { debtor: 'GUEST' | 'COMPANY'; buyerTaxId?: string; buyerName?: string }, @Req() req: AuthenticatedRequest) {
    return { data: await this.plans.issueInvoice(id, dto.debtor, { buyerTaxId: dto.buyerTaxId, buyerName: dto.buyerName, userId: req.user.id }) };
  }
}
