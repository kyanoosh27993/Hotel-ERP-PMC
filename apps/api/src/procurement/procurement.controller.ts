/**
 * procurement.controller.ts — فاز ۷ (موج ۲): مسیرهای نسخه‌دار /api/v1/procurement/...
 * تأیید سفارش خرید فقط با procurement.manage؛ رسید با procurement.receive.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { ProcurementService } from './procurement.service';

export class CreateSupplierDto {
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
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  ledgerCode?: string;

  @IsOptional()
  @IsString()
  partyId?: string; // پیوند با ثبت یکتای اشخاص (Party kind=SUPPLIER)
}

export class RequisitionLineDto {
  @IsString()
  stockItemCode!: string;

  @IsNumber()
  @Min(0)
  qty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class CreateRequisitionDto {
  @IsArray()
  items!: RequisitionLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class UpdateRequisitionDto {
  @IsIn(['SUBMITTED', 'APPROVED', 'REJECTED'])
  status!: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
}

export class CreatePoDto {
  @IsString()
  supplierCode!: string;

  @IsOptional()
  @IsString()
  requisitionId?: string;

  @IsArray()
  items!: Array<{ stockItemCode: string; qty: number; unitCostRials: number; taxRateBps?: number }>;
}

export class GrnLineDto {
  @IsOptional()
  @IsString()
  poLineId?: string;

  @IsOptional()
  @IsString()
  stockItemCode?: string;

  @IsNumber()
  @Min(0)
  qtyReceived!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitCostRials?: number;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class CreateGrnDto {
  @IsString()
  poCode!: string;

  @IsArray()
  lines!: GrnLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

@ApiTags('procurement')
@ApiBearerAuth()
@Controller('procurement')
export class ProcurementController {
  constructor(private readonly svc: ProcurementService) {}

  @Post('suppliers')
  @RequirePermissions(PERMISSIONS.PROC_CREATE) // ثبت فروشنده — دادهٔ پایه؛ تأیید PO جدا می‌ماند (تفکیک وظایف)
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.svc.createSupplier(dto);
  }

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.PROC_VIEW)
  suppliers() {
    return this.svc.listSuppliers();
  }

  /** اصلاح فروشندهٔ موجود — ثبت دوباره ممنوع است (نیاز یکتایی) — دادهٔ پایه با PROC_CREATE */
  @Patch('suppliers/:code')
  @RequirePermissions(PERMISSIONS.PROC_CREATE)
  updateSupplier(@Param('code') code: string, @Body() dto: CreateSupplierDto) {
    return this.svc.updateSupplier(code, dto);
  }

  @Post('requisitions')
  @RequirePermissions(PERMISSIONS.PROC_CREATE)
  createRequisition(@Body() dto: CreateRequisitionDto, @Req() req: AuthenticatedRequest) {
    return this.svc.createRequisition({ ...dto, userId: req.user.id });
  }

  @Post('requisitions/:id')
  @RequirePermissions(PERMISSIONS.PROC_MANAGE)
  updateRequisition(@Param('id') id: string, @Body() dto: UpdateRequisitionDto, @Req() req: AuthenticatedRequest) {
    return this.svc.updateRequisition({ id, status: dto.status, userId: req.user.id });
  }

  @Get('requisitions')
  @RequirePermissions(PERMISSIONS.PROC_VIEW)
  requisitions(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.listRequisitions(status, limit ? Number(limit) : undefined);
  }

  @Post('orders')
  @RequirePermissions(PERMISSIONS.PROC_CREATE)
  createPurchaseOrder(@Body() dto: CreatePoDto, @Req() req: AuthenticatedRequest) {
    return this.svc.createPurchaseOrder({ ...dto, userId: req.user.id });
  }

  @Post('orders/:id/approve')
  @RequirePermissions(PERMISSIONS.PROC_MANAGE)
  approvePurchaseOrder(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.svc.approvePurchaseOrder(id, req.user.id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.PROC_MANAGE)
  cancelPurchaseOrder(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.svc.cancelPurchaseOrder(id, req.user.id);
  }

  @Get('orders')
  @RequirePermissions(PERMISSIONS.PROC_VIEW)
  purchaseOrders(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.listPurchaseOrders(status, limit ? Number(limit) : undefined);
  }

  @Post('receipts')
  @RequirePermissions(PERMISSIONS.PROC_RECEIVE)
  createReceipt(@Body() dto: CreateGrnDto, @Req() req: AuthenticatedRequest) {
    return this.svc.createGoodsReceipt({ ...dto, userId: req.user.id });
  }

  @Get('receipts')
  @RequirePermissions(PERMISSIONS.PROC_VIEW)
  receipts(@Query('limit') limit?: string) {
    return this.svc.listReceipts(limit ? Number(limit) : undefined);
  }
}
