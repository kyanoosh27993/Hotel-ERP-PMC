/**
 * housekeeping.controller.ts — فاز ۱۰ (موج ۱): مسیرهای نسخه‌دار /api/v1/housekeeping/...
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { HousekeepingService } from './housekeeping.service';

export class CreateTaskDto {
  @IsString()
  roomCode!: string;

  @IsIn(['CLEANING', 'TURNDOWN', 'INSPECTION', 'MAINTENANCE_FOLLOWUP'])
  kind!: 'CLEANING' | 'TURNDOWN' | 'INSPECTION' | 'MAINTENANCE_FOLLOWUP';

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  @IsString()
  scheduledDate!: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class AssignTaskDto {
  @IsOptional()
  @IsString()
  assigneeId?: string | null;
}

export class CompleteTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class CancelTaskDto {
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  note!: string;
}

export class InspectionDto {
  @IsString()
  roomCode!: string;

  @IsBoolean()
  passed!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  score?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  issues?: string[];

  @IsOptional()
  @IsString()
  taskId?: string;
}

export class MaintenanceCreateDto {
  @IsOptional()
  @IsString()
  roomCode?: string;

  @IsOptional()
  @IsString()
  assetCode?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export class MaintenanceUpdateDto {
  @IsOptional()
  @IsIn(['ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELED'])
  status?: 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';

  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNote?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costRials?: number;
}

export class LaundryBatchDto {
  @IsIn(['OUT_WASH', 'IN_RETURN'])
  direction!: 'OUT_WASH' | 'IN_RETURN';
}

export class LaundryMovementDto {
  @IsString()
  batchId!: string;

  @IsString()
  linenCode!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

export class LaundryCloseDto {
  @IsString()
  batchId!: string;
}

export class LostFoundCreateDto {
  @IsString()
  roomCode!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  itemDesc!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  storageLocation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class LostFoundResolveDto {
  @IsIn(['RETURNED', 'DISPOSED'])
  action!: 'RETURNED' | 'DISPOSED';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  returnedTo?: string;
}

@ApiTags('housekeeping')
@ApiBearerAuth()
@Controller('housekeeping')
export class HousekeepingController {
  constructor(private readonly svc: HousekeepingService) {}

  // وظایف
  @Post('tasks')
  @RequirePermissions(PERMISSIONS.HOUSEKEEPING_TASK)
  createTask(@Body() dto: CreateTaskDto, @Req() req: AuthenticatedRequest) {
    return this.svc.createTask({ ...dto, userId: req.user.id });
  }

  @Post('tasks/:id/assign')
  @RequirePermissions(PERMISSIONS.HOUSEKEEPING_TASK)
  assignTask(@Param('id') id: string, @Body() dto: AssignTaskDto) {
    return this.svc.assignTask(id, dto.assigneeId ?? null);
  }

  @Post('tasks/:id/start')
  @RequirePermissions(PERMISSIONS.HOUSEKEEPING_TASK)
  startTask(@Param('id') id: string) {
    return this.svc.startTask(id);
  }

  @Post('tasks/:id/complete')
  @RequirePermissions(PERMISSIONS.HOUSEKEEPING_TASK)
  completeTask(@Param('id') id: string, @Body() dto: CompleteTaskDto, @Req() req: AuthenticatedRequest) {
    return this.svc.completeTask({ taskId: id, note: dto.note, userId: req.user.id });
  }

  @Post('tasks/:id/cancel')
  @RequirePermissions(PERMISSIONS.HOUSEKEEPING_TASK)
  cancelTask(@Param('id') id: string, @Body() dto: CancelTaskDto) {
    return this.svc.cancelTask(id, dto.note);
  }

  @Get('tasks')
  @RequirePermissions(PERMISSIONS.ROOM_VIEW, PERMISSIONS.HOUSEKEEPING_TASK)
  listTasks(
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listTasks({
      date,
      status,
      assigneeId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // بازرسی
  @Post('inspections')
  @RequirePermissions(PERMISSIONS.HOUSEKEEPING_INSPECT)
  recordInspection(@Body() dto: InspectionDto, @Req() req: AuthenticatedRequest) {
    return this.svc.recordInspection({ ...dto, userId: req.user.id });
  }

  // تعمیرات
  @Post('maintenance')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_REPORT)
  createMaintenance(@Body() dto: MaintenanceCreateDto, @Req() req: AuthenticatedRequest) {
    return this.svc.createMaintenanceRequest({ ...dto, userId: req.user.id });
  }

  @Post('maintenance/:id')
  @RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
  updateMaintenance(@Param('id') id: string, @Body() dto: MaintenanceUpdateDto) {
    return this.svc.updateMaintenanceRequest({ id, ...dto });
  }

  @Get('maintenance')
  @RequirePermissions(PERMISSIONS.ROOM_VIEW, PERMISSIONS.MAINTENANCE_REPORT)
  listMaintenance(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.listMaintenance(status, limit ? Number(limit) : undefined);
  }

  // لاندری
  @Post('laundry/batches')
  @RequirePermissions(PERMISSIONS.LAUNDRY_MANAGE)
  openBatch(@Body() dto: LaundryBatchDto, @Req() req: AuthenticatedRequest) {
    return this.svc.openLaundryBatch({ direction: dto.direction, userId: req.user.id });
  }

  @Post('laundry/movements')
  @RequirePermissions(PERMISSIONS.LAUNDRY_MANAGE)
  upsertMovement(@Body() dto: LaundryMovementDto, @Req() req: AuthenticatedRequest) {
    return this.svc.upsertLaundryMovement({ ...dto, userId: req.user.id });
  }

  @Post('laundry/batches/close')
  @RequirePermissions(PERMISSIONS.LAUNDRY_MANAGE)
  closeBatch(@Body() dto: LaundryCloseDto) {
    return this.svc.closeLaundryBatch(dto.batchId);
  }

  @Get('laundry')
  @RequirePermissions(PERMISSIONS.LAUNDRY_MANAGE)
  listLaundry(@Query('limit') limit?: string) {
    return this.svc.listLaundry(limit ? Number(limit) : undefined);
  }

  // اشیای جامانده
  @Post('lost-found')
  @RequirePermissions(PERMISSIONS.LOSTFOUND_MANAGE)
  registerLostFound(@Body() dto: LostFoundCreateDto, @Req() req: AuthenticatedRequest) {
    return this.svc.registerLostFound({ ...dto, userId: req.user.id });
  }

  @Post('lost-found/:id/resolve')
  @RequirePermissions(PERMISSIONS.LOSTFOUND_MANAGE)
  resolveLostFound(@Param('id') id: string, @Body() dto: LostFoundResolveDto) {
    return this.svc.resolveLostFound({ id, ...dto });
  }

  @Get('lost-found')
  @RequirePermissions(PERMISSIONS.LOSTFOUND_MANAGE)
  listLostFound(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.listLostFound(status, limit ? Number(limit) : undefined);
  }
}
