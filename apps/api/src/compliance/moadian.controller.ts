/**
 * moadian.controller.ts — فاز ۹ / F9-T2: مسیرهای صورتحساب الکترونیکی مؤدیان.
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { MoadianService } from './moadian.service';

class GenerateInvoiceDto {
  @IsString() @MinLength(8)
  journalEntryId!: string;

  @IsOptional() @IsString()
  buyerTaxId?: string;

  @IsOptional() @IsString()
  buyerName?: string;
}

class CancelInvoiceDto {
  @IsString() @MinLength(3)
  reason!: string;
}

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance/moadian')
export class MoadianController {
  constructor(private readonly svc: MoadianService) {}

  /** تولید صورتحساب از سند فروش قطعی + در صف ارسال گذاشتن */
  @Post('invoices')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  async generate(@Body() dto: GenerateInvoiceDto, @Req() req: AuthenticatedRequest) {
    return { data: await this.svc.generate({ ...dto, userId: req.user.id }) };
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  async list(@Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.list({ status, from, to });
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  async get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  /** وضعیت زنده از سندباکس مؤدیان (poll) */
  @Get('invoices/:id/status')
  @RequirePermissions(PERMISSIONS.INVOICE_VIEW)
  async status(@Param('id') id: string) {
    return this.svc.liveStatus(id);
  }

  /** تلاش مجدد صورتحساب ناموفق */
  @Post('invoices/:id/retry')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  async retry(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.svc.retry(id, req.user.id);
  }

  /** لغو/استورنو صورتحساب پذیرفته‌شده (تأییدکننده) */
  @Post('invoices/:id/cancel')
  @RequirePermissions(PERMISSIONS.INVOICE_SEND)
  async cancel(@Param('id') id: string, @Body() dto: CancelInvoiceDto, @Req() req: AuthenticatedRequest) {
    return this.svc.cancel(id, dto.reason, req.user.id);
  }
}
