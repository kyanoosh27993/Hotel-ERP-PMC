/**
 * directtax.controller.ts — فاز ۹ / F9-T5: مسیرهای مالیات مستقیم.
 */
import { Body, Controller, Get, Header, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { DirectTaxService } from './directtax.service';

class TaxYearDto {
  @Type(() => Number) @IsInt() @Min(1300) @Max(1500)
  taxYear!: number;
}

class PlanUpsertDto extends TaxYearDto {
  @IsObject()
  planJson!: Record<string, unknown>;
}

class ComputeDto extends TaxYearDto {
  @IsOptional() @IsObject()
  planJson?: Record<string, unknown>;
}

@ApiTags('compliance-directtax')
@ApiBearerAuth()
@Controller('compliance/directtax')
export class DirectTaxController {
  constructor(private readonly svc: DirectTaxService) {}

  private permsOf(req: AuthenticatedRequest): Set<string> {
    return req.user.perms ?? new Set<string>();
  }

  @Get('plan')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_VIEW)
  async plan(@Query() q: TaxYearDto) {
    return this.svc.getPlan(q.taxYear);
  }

  @Post('plan')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_MANAGE)
  async upsertPlan(@Body() dto: PlanUpsertDto, @Req() req: AuthenticatedRequest) {
    return this.svc.upsertPlan({ taxYear: dto.taxYear, planJson: dto.planJson, userId: req.user.id });
  }

  @Post('plan/confirm')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_MANAGE)
  async confirmPlan(@Body() dto: TaxYearDto, @Req() req: AuthenticatedRequest) {
    return this.svc.confirmPlan({ taxYear: dto.taxYear, userId: req.user.id });
  }

  @Get('return')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_VIEW)
  async ret(@Query() q: TaxYearDto) {
    return this.svc.getReturn(q.taxYear);
  }

  @Post('return/compute')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_MANAGE)
  async compute(@Body() dto: ComputeDto, @Req() req: AuthenticatedRequest) {
    return this.svc.compute({ taxYear: dto.taxYear, userId: req.user.id });
  }

  @Get('counterparties')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_VIEW)
  async counterparties(@Query() q: TaxYearDto) {
    return this.svc.counterparties(q.taxYear);
  }

  /** درخواست ارسال اظهارنامه → نمونهٔ گردش کار تأیید (WF-DIRECTTAX-SUBMIT) */
  @Post('return/submit')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_MANAGE)
  async submit(@Body() dto: TaxYearDto, @Req() req: AuthenticatedRequest) {
    return this.svc.submit({ taxYear: dto.taxYear, userId: req.user.id, userPerms: this.permsOf(req) });
  }

  @Post('return/reopen')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_MANAGE)
  async reopen(@Body() dto: TaxYearDto, @Req() req: AuthenticatedRequest) {
    return this.svc.reopen({ taxYear: dto.taxYear, userId: req.user.id, userPerms: this.permsOf(req) });
  }

  /** فایل استاندارد اظهارنامه — فقط پس از تأیید انسانی */
  @Get('export')
  @RequirePermissions(PERMISSIONS.DIRECTTAX_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@Query() q: TaxYearDto): Promise<string> {
    return this.svc.exportCsv(q.taxYear);
  }
}
