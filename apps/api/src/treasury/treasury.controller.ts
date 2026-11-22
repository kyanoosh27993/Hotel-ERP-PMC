/**
 * treasury.controller.ts — فاز ۵ (موج ۱): مسیرهای نسخه‌دار /api/v1/treasury/...
 * با مجوزهای RBAC محافظت‌شده (سند PHASE5-TREASURY.md).
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { TreasuryService } from './treasury.service';

export class OpenShiftDto {
  @IsString()
  cashAccountId!: string;

  @IsNumber()
  @Min(0)
  openingFloatRials!: number;

  @IsString()
  businessDate!: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class CloseShiftDto {
  @IsString()
  shiftId!: string;

  @IsNumber()
  @Min(0)
  countedRials!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class CashTransactionDto {
  @IsString()
  cashAccountId!: string;

  @IsIn(['RECEIPT', 'PAYMENT', 'TRANSFER', 'REFUND', 'ADJUSTMENT'])
  kind!: 'RECEIPT' | 'PAYMENT' | 'TRANSFER' | 'REFUND' | 'ADJUSTMENT';

  @IsIn(['CASH', 'CARD', 'TRANSFER', 'ONLINE'])
  method!: 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE';

  @IsInt()
  @Min(1)
  amountRials!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  traceNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  counterGlAccountCode?: string;

  @IsOptional()
  @IsString()
  stayId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;

  @IsString()
  businessDate!: string; // YYYY-MM-DD

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class VoidTxnDto {
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

export class StatementLineDto {
  @IsString()
  cashAccountId!: string;

  @IsString()
  valueDate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  externalRef!: string;

  @IsString()
  @MaxLength(240)
  description!: string;

  @IsInt()
  @Min(0)
  debitRials!: number;

  @IsInt()
  @Min(0)
  creditRials!: number;
}

export class ReconcileDto {
  @IsString()
  cashAccountId!: string;

  @IsString()
  runDate!: string;
}

@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  accounts() {
    return this.treasury.listAccounts();
  }

  @Get('accounts/balances')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  balances() {
    return this.treasury.accountBalances();
  }

  @Post('shifts/open')
  @RequirePermissions(PERMISSIONS.TREASURY_SHIFT_MANAGE)
  openShift(@Body() dto: OpenShiftDto, @Req() req: AuthenticatedRequest) {
    return this.treasury.openShift({ ...dto, userId: req.user.id });
  }

  @Post('shifts/close')
  @RequirePermissions(PERMISSIONS.TREASURY_SHIFT_MANAGE)
  closeShift(@Body() dto: CloseShiftDto) {
    return this.treasury.closeShift(dto);
  }

  @Get('shifts')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  shifts(@Query('limit') limit?: string) {
    return this.treasury.listShifts(limit ? Number(limit) : undefined);
  }

  @Post('transactions')
  @RequirePermissions(PERMISSIONS.TREASURY_TXN_CREATE)
  postTransaction(@Body() dto: CashTransactionDto, @Req() req: AuthenticatedRequest) {
    return this.treasury.postTransaction({ ...dto, userId: req.user.id });
  }

  @Post('transactions/:id/void')
  @RequirePermissions(PERMISSIONS.TREASURY_VOID)
  voidTransaction(@Param('id') id: string, @Body() dto: VoidTxnDto, @Req() req: AuthenticatedRequest) {
    return this.treasury.voidTransaction(id, dto.reason, req.user.id);
  }

  @Get('transactions')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  transactions(
    @Query('cashAccountId') cashAccountId?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.treasury.listTransactions({
      cashAccountId,
      kind,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('bank-statements')
  @RequirePermissions(PERMISSIONS.TREASURY_RECONCILE)
  addStatementLine(@Body() dto: StatementLineDto, @Req() req: AuthenticatedRequest) {
    return this.treasury.addStatementLine({ ...dto, userId: req.user.id });
  }

  @Post('reconciliations/run')
  @RequirePermissions(PERMISSIONS.TREASURY_RECONCILE)
  runReconciliation(@Body() dto: ReconcileDto, @Req() req: AuthenticatedRequest) {
    return this.treasury.runReconciliation({ ...dto, userId: req.user.id });
  }

  @Get('reconciliations/summary')
  @RequirePermissions(PERMISSIONS.TREASURY_VIEW)
  reconciliations() {
    return this.treasury.reconciliationSummary();
  }
}
