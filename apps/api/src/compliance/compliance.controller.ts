/**
 * compliance.controller.ts — فاز ۹: مسیرهای کتابخانهٔ قوانین و اظهارنامهٔ VAT
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { ComplianceService } from './compliance.service';

class UpsertLawDto {
  @IsString() @MinLength(4)
  code!: string;

  @IsString() @MinLength(4)
  title!: string;

  @IsString() @MinLength(4)
  lawName!: string;

  @IsOptional() @IsString()
  article?: string;

  @IsOptional() @IsString()
  note?: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional() @IsDateString()
  effectiveTo?: string;

  @IsObject()
  params!: Record<string, unknown>;

  @IsOptional() @IsString()
  testScenario?: string;

  @IsOptional() @IsString()
  legalOwner?: string;

  @IsOptional() @IsString()
  sourceRef?: string;
}

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  @Get('laws')
  @RequirePermissions(PERMISSIONS.LAW_VIEW)
  async laws() {
    return { data: await this.svc.listLaws() };
  }

  @Get('laws/:code')
  @RequirePermissions(PERMISSIONS.LAW_VIEW)
  async law(@Param('code') code: string) {
    return { data: await this.svc.getLaw(code) };
  }

  @Post('laws')
  @RequirePermissions(PERMISSIONS.LAW_MANAGE)
  async upsert(@Body() dto: UpsertLawDto, @Req() req: AuthenticatedRequest) {
    return { data: await this.svc.upsertLaw({ ...dto, userId: req.user.id }) };
  }

  /** نرخ پارامتریک در تاریخ — مبنای موتور انطباق */
  @Get('laws/:code/rate')
  @RequirePermissions(PERMISSIONS.LAW_VIEW)
  async rate(@Param('code') code: string, @Query('date') date?: string) {
    return { data: await this.svc.rateAt(code, date ? new Date(`${date}T00:00:00Z`) : new Date()) };
  }

  @Get('vat/declaration')
  @RequirePermissions(PERMISSIONS.JOURNAL_VIEW)
  vat(@Query('from') from: string, @Query('to') to: string) {
    return this.svc.vatDeclaration(from, to);
  }
}
