/**
 * workflow.controller.ts — فاز ۸ / F8-T6: مسیرهای موتور گردش کار.
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { WorkflowService, WorkflowStep } from './workflow.service';

class StepDto implements WorkflowStep {
  @IsString() @MinLength(1)
  title!: string;

  @IsString() @MinLength(3)
  permission!: string;

  @IsNumber()
  order!: number;

  @IsOptional() @IsNumber()
  minApprovers?: number;

  @IsOptional() @IsBoolean()
  selfApproval?: boolean;
}

class UpsertDefDto {
  @IsString() @MinLength(4)
  code!: string;

  @IsString() @MinLength(4)
  title!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepDto)
  steps!: StepDto[];
}

class StartDto {
  @IsString() @MinLength(4)
  defCode!: string;

  @IsString() @MinLength(4)
  entityType!: string;

  @IsString() @MinLength(8)
  entityId!: string;

  @IsString() @MinLength(2)
  title!: string;
}

class ActDto {
  @IsOptional() @IsString()
  comment?: string;

  @IsOptional() @IsString()
  reason?: string;
}

@ApiTags('workflow')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowController {
  constructor(private readonly svc: WorkflowService) {}

  /** مجوزهای کاربر (guard آن را روی request می‌گذارد) */
  private permsOf(req: AuthenticatedRequest): Set<string> {
    return req.user.perms ?? new Set<string>();
  }

  @Get('defs')
  @RequirePermissions(PERMISSIONS.WORKFLOW_VIEW)
  async defs() {
    return this.svc.listDefs();
  }

  @Post('defs')
  @RequirePermissions(PERMISSIONS.WORKFLOW_MANAGE)
  async upsertDef(@Body() dto: UpsertDefDto, @Req() req: AuthenticatedRequest) {
    return this.svc.upsertDef({ ...dto, userId: req.user.id });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WORKFLOW_ACT)
  async start(@Body() dto: StartDto, @Req() req: AuthenticatedRequest) {
    return this.svc.start({ ...dto, userId: req.user.id, userPerms: this.permsOf(req) });
  }

  @Get()
  @RequirePermissions(PERMISSIONS.WORKFLOW_VIEW)
  async list(@Query('status') status?: string, @Query('entityType') entityType?: string) {
    return this.svc.list({ status, entityType });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WORKFLOW_VIEW)
  async detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.WORKFLOW_ACT)
  async approve(@Param('id') id: string, @Body() dto: ActDto, @Req() req: AuthenticatedRequest) {
    return this.svc.approve(id, req.user.id, req.user.fullName ?? req.user.username, this.permsOf(req), dto.comment ?? '');
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.WORKFLOW_ACT)
  async reject(@Param('id') id: string, @Body() dto: ActDto, @Req() req: AuthenticatedRequest) {
    return this.svc.reject(id, req.user.id, req.user.fullName ?? req.user.username, this.permsOf(req), dto.reason ?? '');
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.WORKFLOW_ACT)
  async cancel(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.svc.cancel(id, req.user.id, this.permsOf(req));
  }

  /** راستی‌آزمایی زنجیرهٔ امضای الکترونیکی */
  @Get(':id/verify')
  @RequirePermissions(PERMISSIONS.WORKFLOW_VIEW)
  async verify(@Param('id') id: string) {
    return this.svc.verify(id);
  }
}
