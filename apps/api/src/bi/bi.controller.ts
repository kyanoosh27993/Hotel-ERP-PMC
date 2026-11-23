/**
 * bi.controller.ts — موج ۴ / فاز ۱۱: مسیرهای BI و هوش مصنوعی.
 * همهٔ مسیرهای «مدیریت» خروجی AI را فقط به‌صورت پیش‌نویس می‌سازند — قطعی‌سازی با تأیید انسانی.
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { BiService } from './bi.service';

class RangeDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
  @IsOptional() @IsString() @MaxLength(20)
  periodCode?: string;
}

class BudgetDto {
  @Type(() => Number) @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;
  @IsString() @MinLength(4) @MaxLength(20)
  periodCode!: string;
  @IsString() @MinLength(4) @MaxLength(20)
  costCenterCode!: string;
  @IsString() @MinLength(1) @MaxLength(20)
  revenueRials!: string;
  @IsString() @MinLength(1) @MaxLength(20)
  costRials!: string;
  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

class BudgetListDto {
  @IsString() @MinLength(4) @MaxLength(20)
  periodCode!: string;
}

class AskDto {
  @IsString() @MinLength(2) @MaxLength(300)
  question!: string;
}

class DocDto {
  @IsString() @MinLength(10) @MaxLength(4000)
  text!: string;
}

class DecideDto {
  @IsIn(['APPROVE', 'REJECT'])
  action!: 'APPROVE' | 'REJECT';
}

class ForecastDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(26)
  @IsOptional()
  weeks?: number;
}

class RateListDto {
  @IsOptional() @IsDateString()
  date?: string;
}

@ApiTags('bi-ai')
@ApiBearerAuth()
@Controller('bi')
export class BiController {
  constructor(private readonly bi: BiService) {}

  private uid(req: AuthenticatedRequest): string | undefined {
    return req.user?.id;
  }

  // ── F11-T1 ──
  @Get('departments')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  departments(@Query() q: RangeDto) {
    return this.bi.departments(q.from, q.to, q.periodCode);
  }

  @Post('budget')
  @RequirePermissions(PERMISSIONS.BI_MANAGE)
  upsertBudget(@Body() dto: BudgetDto, @Req() req: AuthenticatedRequest) {
    return this.bi.upsertBudget({ ...dto, userId: this.uid(req) });
  }

  @Get('budget')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  listBudgets(@Query() q: BudgetListDto) {
    return this.bi.listBudgets(q.periodCode);
  }

  // ── F11-T2 ──
  @Post('assistant')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  ask(@Body() dto: AskDto, @Req() req: AuthenticatedRequest) {
    return this.bi.assistant(dto.question, this.uid(req));
  }

  // ── F11-T3 ──
  @Get('cashflow-forecast')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  cashflow(@Query() q: ForecastDto) {
    return this.bi.cashflowForecast(q.weeks ?? 13);
  }

  // ── F11-T4 ──
  @Post('smart-document')
  @RequirePermissions(PERMISSIONS.BI_MANAGE)
  createDocDraft(@Body() dto: DocDto, @Req() req: AuthenticatedRequest) {
    return this.bi.createDocDraft(dto.text, this.uid(req));
  }

  @Get('smart-document')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  listDocDrafts() {
    return this.bi.listDocDrafts();
  }

  @Post('smart-document/:id/approve')
  @RequirePermissions(PERMISSIONS.BI_MANAGE)
  approveDocDraft(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.bi.approveDocDraft(id, this.uid(req));
  }

  @Post('smart-document/:id/discard')
  @RequirePermissions(PERMISSIONS.BI_MANAGE)
  discardDocDraft(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.bi.discardDocDraft(id, this.uid(req));
  }

  // ── F11-T5 ──
  @Get('revenue-forecast')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  revenueForecast(@Req() req: AuthenticatedRequest) {
    return this.bi.revenueForecast(this.uid(req));
  }

  @Get('rate-suggestions')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  listRateSuggestions(@Query() q: RateListDto) {
    return this.bi.listRateSuggestions(q.date);
  }

  @Post('rate-suggestions/:id/decide')
  @RequirePermissions(PERMISSIONS.BI_MANAGE)
  decideRate(@Param('id') id: string, @Body() dto: DecideDto, @Req() req: AuthenticatedRequest) {
    return this.bi.decideRate(id, dto.action, this.uid(req));
  }

  // ── F11-T6 ──
  @Get('anomalies')
  @RequirePermissions(PERMISSIONS.BI_VIEW)
  anomalies(@Req() req: AuthenticatedRequest) {
    return this.bi.anomalies(this.uid(req));
  }
}
