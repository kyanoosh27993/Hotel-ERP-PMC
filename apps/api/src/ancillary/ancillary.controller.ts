/**
 * ancillary.controller.ts — فاز ۱۰ (موج ۱): مسیرهای نسخه‌دار /api/v1/ancillary/...
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RequireAnyPermissions, RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { AncillaryService } from './ancillary.service';

export class CreateServiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(24)
  code!: string; // SVC-PHONE …

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameFa!: string;

  @IsIn(['PHONE', 'PARKING', 'TAXI', 'POOL', 'INTERNET', 'SHOP', 'CEREMONY', 'OTHER'])
  category!: 'PHONE' | 'PARKING' | 'TAXI' | 'POOL' | 'INTERNET' | 'SHOP' | 'CEREMONY' | 'OTHER';

  @IsInt()
  @Min(1)
  unitPriceRials!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  taxRateBps?: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  glRevenueAccountCode?: string;
}

export class ConfirmOrderDto {
  @IsString()
  serviceCode!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  stayCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class CancelOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

@ApiTags('ancillary')
@ApiBearerAuth()
@Controller('ancillary')
export class AncillaryController {
  constructor(private readonly svc: AncillaryService) {}

  @Get('services')
  @RequireAnyPermissions(PERMISSIONS.ANCILLARY_ORDER, PERMISSIONS.ASSET_VIEW)
  services(@Query('all') all?: string) {
    return this.svc.listServices(all === '1');
  }

  @Post('services')
  @RequirePermissions(PERMISSIONS.ASSET_MANAGE)
  createService(@Body() dto: CreateServiceDto) {
    return this.svc.createService(dto);
  }

  @Post('orders')
  @RequirePermissions(PERMISSIONS.ANCILLARY_ORDER)
  confirmOrder(@Body() dto: ConfirmOrderDto, @Req() req: AuthenticatedRequest) {
    return this.svc.confirmOrder({ ...dto, userId: req.user.id });
  }

  @Post('orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.ANCILLARY_ORDER)
  cancelOrder(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.svc.cancelOrder(id, dto.reason);
  }

  @Get('orders')
  @RequireAnyPermissions(PERMISSIONS.ANCILLARY_ORDER, PERMISSIONS.ASSET_VIEW)
  orders(@Query('limit') limit?: string) {
    return this.svc.listOrders(limit ? Number(limit) : undefined);
  }
}
