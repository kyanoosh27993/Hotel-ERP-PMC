/**
 * stores.controller.ts — فاز ۷ (موج ۲): مسیرهای نسخه‌دار /api/v1/stores/...
 */
import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { StoresService } from './stores.service';

export class CreateStockItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameFa!: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitPurchase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unitConsumption?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  conversionFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minQty?: number;

  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @IsOptional()
  @IsBoolean()
  allowNegative?: boolean;
}

export class TransferDto {
  @IsString()
  stockItemCode!: string;

  @IsString()
  fromWarehouseCode!: string;

  @IsString()
  toWarehouseCode!: string;

  @IsNumber()
  @Min(0)
  qty!: number;
}

export class AdjustDto {
  @IsString()
  stockItemCode!: string;

  @IsIn(['ADJUST_IN', 'ADJUST_OUT', 'WASTE'])
  direction!: 'ADJUST_IN' | 'ADJUST_OUT' | 'WASTE';

  @IsNumber()
  @Min(0)
  qty!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  note!: string;
}

export class OpenCountDto {
  @IsString()
  warehouseCode!: string;
}

export class CountLineDto {
  @IsString()
  countId!: string;

  @IsString()
  stockItemCode!: string;

  @IsNumber()
  @Min(0)
  qtyCounted!: number;
}

export class CloseCountDto {
  @IsString()
  countId!: string;
}

@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(private readonly svc: StoresService) {}

  @Get('items')
  @RequirePermissions(PERMISSIONS.STORES_VIEW)
  items(@Query('all') all?: string) {
    return this.svc.listStockItems(all === '1');
  }

  @Post('items')
  @RequirePermissions(PERMISSIONS.STORES_MANAGE)
  createItem(@Body() dto: CreateStockItemDto) {
    return this.svc.createStockItem(dto);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.STORES_VIEW)
  movements(@Query('stockItemCode') stockItemCode?: string, @Query('limit') limit?: string) {
    return this.svc.listMovements(stockItemCode, limit ? Number(limit) : undefined);
  }

  @Post('transfers')
  @RequirePermissions(PERMISSIONS.STORES_MANAGE)
  transfer(@Body() dto: TransferDto, @Req() req: AuthenticatedRequest) {
    return this.svc.transfer({ ...dto, userId: req.user.id });
  }

  @Post('adjustments')
  @RequirePermissions(PERMISSIONS.STORES_MANAGE)
  adjust(@Body() dto: AdjustDto, @Req() req: AuthenticatedRequest) {
    return this.svc.adjust({ ...dto, userId: req.user.id });
  }

  @Post('counts')
  @RequirePermissions(PERMISSIONS.STORES_COUNT)
  openCount(@Body() dto: OpenCountDto, @Req() req: AuthenticatedRequest) {
    return this.svc.openCount({ ...dto, userId: req.user.id });
  }

  @Post('counts/lines')
  @RequirePermissions(PERMISSIONS.STORES_COUNT)
  setCountLine(@Body() dto: CountLineDto) {
    return this.svc.setCountLine(dto);
  }

  @Post('counts/close')
  @RequirePermissions(PERMISSIONS.STORES_COUNT)
  closeCount(@Body() dto: CloseCountDto, @Req() req: AuthenticatedRequest) {
    return this.svc.closeCount({ countId: dto.countId, userId: req.user.id });
  }

  @Get('counts')
  @RequirePermissions(PERMISSIONS.STORES_VIEW)
  counts(@Query('limit') limit?: string) {
    return this.svc.listCounts(limit ? Number(limit) : undefined);
  }

  @Get('cost-control')
  @RequirePermissions(PERMISSIONS.STORES_VIEW)
  costControl(@Query('from') from: string, @Query('to') to: string) {
    return this.svc.costControl(from, to);
  }

  @Get('reorder')
  @RequirePermissions(PERMISSIONS.STORES_VIEW)
  reorder() {
    return this.svc.reorderReport();
  }
}
