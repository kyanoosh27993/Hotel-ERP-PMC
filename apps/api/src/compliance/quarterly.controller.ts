/**
 * quarterly.controller.ts — فاز ۹ / F9-T4: مسیرهای معاملات فصلی.
 */
import {
  Body, Controller, Get, Header, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { QuarterlyService } from './quarterly.service';

class PeriodDto {
  @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;

  @IsInt() @Min(1) @Max(4)
  quarter!: number;
}

class RegisterDto {
  @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;

  @IsInt() @Min(1) @Max(4)
  quarter!: number;

  @IsString() @MinLength(4) @MaxLength(10)
  txType!: string; // SALE | PURCHASE

  @IsString() @MinLength(2) @MaxLength(200)
  counterpartyName!: string;

  @IsOptional() @IsString() @MaxLength(12)
  counterpartyTin?: string;

  /** مبلغ معامله به ریال — رشته/عدد (BigInt سمت سرویس) */
  @IsString() @MinLength(1)
  amountRials!: string;

  @IsOptional() @IsString()
  vatRials?: string;

  /** تاریخ معامله ISO (YYYY-MM-DD) — باید داخل بازهٔ فصل باشد */
  @IsString() @MinLength(10) @MaxLength(10)
  txDate!: string;

  @IsOptional() @IsBoolean()
  exempt?: boolean;

  @IsOptional() @IsString() @MaxLength(80)
  docRef?: string;

  @IsOptional() @IsString() @MaxLength(300)
  notes?: string;
}

class DeriveDto {
  @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;

  @IsInt() @Min(1) @Max(4)
  quarter!: number;
}

class ListQuery {
  @Type(() => Number) @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4)
  quarter?: number;

  @IsOptional() @IsString() @MaxLength(10)
  txType?: string;
}

class SummaryQuery {
  @Type(() => Number) @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(4)
  quarter!: number;
}

@ApiTags('compliance-quarterly')
@ApiBearerAuth()
@Controller('compliance/quarterly')
export class QuarterlyController {
  constructor(private readonly svc: QuarterlyService) {}

  private permsOf(req: AuthenticatedRequest): Set<string> {
    return req.user.perms ?? new Set<string>();
  }

  @Get('periods')
  @RequirePermissions(PERMISSIONS.QUARTERLY_VIEW)
  async periods(@Query('taxYear') taxYear?: string) {
    return this.svc.listPeriods(taxYear ? Number(taxYear) : undefined);
  }

  @Post('periods')
  @RequirePermissions(PERMISSIONS.QUARTERLY_MANAGE)
  async ensurePeriod(@Body() dto: PeriodDto) {
    const p = await this.svc.ensurePeriod(dto.taxYear, dto.quarter);
    return { data: { id: p.id, taxYear: p.taxYear, quarter: p.quarter, status: p.status } };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUARTERLY_MANAGE)
  async register(@Body() dto: RegisterDto, @Req() req: AuthenticatedRequest) {
    return this.svc.register({
      taxYear: dto.taxYear, quarter: dto.quarter, txType: dto.txType,
      counterpartyName: dto.counterpartyName, counterpartyTin: dto.counterpartyTin,
      amountRials: dto.amountRials, vatRials: dto.vatRials, txDate: dto.txDate,
      exempt: dto.exempt, docRef: dto.docRef, notes: dto.notes, userId: req.user.id,
    });
  }

  @Post('derive')
  @RequirePermissions(PERMISSIONS.QUARTERLY_MANAGE)
  async derive(@Body() dto: DeriveDto, @Req() req: AuthenticatedRequest) {
    return this.svc.deriveFromPos({ ...dto, userId: req.user.id });
  }

  @Get()
  @RequirePermissions(PERMISSIONS.QUARTERLY_VIEW)
  async list(@Query() q: ListQuery) {
    return this.svc.listTaxes({ taxYear: q.taxYear, quarter: q.quarter, txType: q.txType });
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.QUARTERLY_VIEW)
  async summary(@Query() q: SummaryQuery) {
    return this.svc.summary(q.taxYear, q.quarter);
  }

  /** فایل استاندارد اداره دارایی — CSV با BOM */
  @Get('export')
  @RequirePermissions(PERMISSIONS.QUARTERLY_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@Query() q: SummaryQuery): Promise<string> {
    return this.svc.exportCsv(q.taxYear, q.quarter);
  }

  /** درخواست بستن فصل → نمونهٔ گردش کار تأیید (WF-QUARTERLY-CLOSE) */
  @Post('close')
  @RequirePermissions(PERMISSIONS.QUARTERLY_MANAGE)
  async close(@Body() dto: PeriodDto, @Req() req: AuthenticatedRequest) {
    return this.svc.requestClose({ ...dto, userId: req.user.id, userPerms: this.permsOf(req) });
  }

  @Post('reopen')
  @RequirePermissions(PERMISSIONS.QUARTERLY_MANAGE)
  async reopen(@Body() dto: PeriodDto, @Req() req: AuthenticatedRequest) {
    return this.svc.reopen({ ...dto, userId: req.user.id, userPerms: this.permsOf(req) });
  }
}
