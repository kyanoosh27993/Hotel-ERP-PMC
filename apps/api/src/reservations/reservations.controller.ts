import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { ReservationService } from './reservation.service';
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
    });
    return { data: result };
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
