/**
 * rooms.controller.ts — نقشه اتاق: مشاهده (room.view) و تغییر وضعیت لحظه‌ای (room.manage).
 */
import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { RoomsService } from './rooms.service';
import { AuthenticatedRequest } from '../common/authenticated.request';

export class RoomStatusDto {
  @IsIn(['AVAILABLE', 'DIRTY', 'OUT_OF_SERVICE'])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  /** نقشه اتاق — فیلتر وضعیت/طبقه/نوع */
  @RequirePermissions(PERMISSIONS.ROOM_VIEW)
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('floor') floor?: string,
    @Query('roomTypeId') roomTypeId?: string,
  ) {
    const data = await this.rooms.list({
      status: status || undefined,
      floor: floor ? Number(floor) : undefined,
      roomTypeId: roomTypeId || undefined,
    });
    return { data };
  }

  /** تغییر وضعیت لحظه‌ای — AVAILABLE/DIRTY/OUT_OF_SERVICE (تعمیرات با دلیل) */
  @RequirePermissions(PERMISSIONS.ROOM_MANAGE)
  @Patch(':id/status')
  async changeStatus(@Param('id') id: string, @Body() dto: RoomStatusDto, @Req() req: AuthenticatedRequest) {
    const result = await this.rooms.changeStatus(id, dto.status, dto.note, req.user.id);
    return { data: result };
  }
}
