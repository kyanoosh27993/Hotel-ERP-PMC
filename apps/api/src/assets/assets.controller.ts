/**
 * assets.controller.ts — فاز ۱۰ (موج ۱): مسیرهای نسخه‌دار /api/v1/assets/...
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { AssetsService } from './assets.service';

export class RegisterAssetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameFa!: string;

  @IsString()
  @MaxLength(16)
  category!: string; // FUN | ELE | VEH | FUR | IT | OTHER

  @IsString()
  acquiredAt!: string; // YYYY-MM-DD

  @IsInt()
  @Min(1)
  costRials!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salvageRials?: number;

  @IsInt()
  @Min(1)
  usefulLifeMonths!: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  glAssetAccountCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  glAccDepAccountCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  glDepExpenseAccountCode?: string;

  @IsOptional()
  @IsString()
  roomCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class TransferAssetDto {
  @IsOptional()
  @IsString()
  roomCode?: string | null;
}

export class DisposeAssetDto {
  @IsIn(['SOLD', 'SCRAPPED'])
  action!: 'SOLD' | 'SCRAPPED';

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

export class DepreciationRunDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodCode must be 1405-MM' })
  periodCode!: string;
}

@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.ASSET_MANAGE)
  register(@Body() dto: RegisterAssetDto, @Req() req: AuthenticatedRequest) {
    return this.svc.registerAsset({ ...dto, userId: req.user.id });
  }

  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.ASSET_MANAGE)
  transfer(@Param('id') id: string, @Body() dto: TransferAssetDto) {
    return this.svc.transferAsset(id, dto.roomCode ?? null);
  }

  @Post(':id/dispose')
  @RequirePermissions(PERMISSIONS.ASSET_MANAGE)
  dispose(@Param('id') id: string, @Body() dto: DisposeAssetDto) {
    return this.svc.disposeAsset(id, dto.action, dto.reason);
  }

  @Post('depreciation/run')
  @RequirePermissions(PERMISSIONS.ASSET_DEPRECIATE)
  runDepreciation(@Body() dto: DepreciationRunDto, @Req() req: AuthenticatedRequest) {
    return this.svc.runDepreciation({ periodCode: dto.periodCode, userId: req.user.id });
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ASSET_VIEW)
  list(@Query('limit') limit?: string) {
    return this.svc.listAssets(limit ? Number(limit) : undefined);
  }

  @Get('depreciation')
  @RequirePermissions(PERMISSIONS.ASSET_VIEW)
  depreciationReport(@Query('periodCode') periodCode: string) {
    return this.svc.depreciationReport(periodCode);
  }
}
