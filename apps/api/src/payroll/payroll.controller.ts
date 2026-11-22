/**
 * payroll.controller.ts — F2-T1…T4: پرسنل، احکام، دوره‌ها و سه لیست رسمی.
 * مجوزها: حسابدار = مشاهده/ثبت/محاسبه؛ تأییدکننده = تأیید؛ هیچ‌کس خودتأییری ندارد.
 */
import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { PayrollService } from './payroll.service';
import { AuthenticatedRequest } from '../common/authenticated.request';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  nationalId?: string;

  /** شبا معتبر ایران (IR + ۲۴ رقم) */
  @IsOptional()
  @IsString()
  @MaxLength(26)
  iban?: string;

  @IsBoolean()
  marital!: boolean;

  @IsInt()
  @Min(0)
  @Max(10)
  dependents!: number;

  @IsOptional()
  @IsString()
  hireDate?: string; // YYYY-MM-DD
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @MaxLength(26) iban?: string;
  @IsOptional() @IsBoolean() marital?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10) dependents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateDecisionDto {
  @IsString()
  @MaxLength(64)
  employeeId!: string;

  /** ریال صحیح به‌صورت رشته (ممیز شناور ممنوع) */
  @IsString()
  @Matches(/^\d+$/, { message: 'baseSalary must be integer rials' })
  baseSalary!: string;

  @IsString()
  @Matches(/^\d+$/)
  seniority!: string;

  @IsString()
  @Matches(/^\d+$/)
  housing!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateRunDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodCode must be like 1405-09' })
  periodCode!: string;
}

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /* ── پرسنل ── */

  @RequirePermissions(PERMISSIONS.PERSONNEL_EDIT)
  @Post('employees')
  async createEmployee(@Body() dto: CreateEmployeeDto, @Req() req: AuthenticatedRequest) {
    const emp = await this.payroll.createEmployee(dto, req.user.id);
    return { data: { id: emp.id, code: emp.code, fullName: `${emp.firstName} ${emp.lastName}` } };
  }

  @RequirePermissions(PERMISSIONS.PERSONNEL_VIEW)
  @Get('employees')
  async listEmployees() {
    const rows = await this.payroll.listEmployees(true);
    return {
      data: rows.map((e) => ({
        id: e.id,
        code: e.code,
        fullName: `${e.firstName} ${e.lastName}`,
        marital: e.marital,
        dependents: e.dependents,
        iban: e.iban,
      })),
      meta: { count: rows.length },
    };
  }

  @RequirePermissions(PERMISSIONS.PERSONNEL_EDIT)
  @Patch('employees/:id')
  async updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Req() req: AuthenticatedRequest) {
    const emp = await this.payroll.updateEmployee(id, dto, req.user.id);
    return { data: { id: emp.id, code: emp.code, active: emp.active } };
  }

  /* ── احکام ── */

  @RequirePermissions(PERMISSIONS.PERSONNEL_EDIT)
  @Post('decisions')
  async createDecision(@Body() dto: CreateDecisionDto, @Req() req: AuthenticatedRequest) {
    const d = await this.payroll.createDecision(dto, req.user.id);
    return { data: { id: d.id, status: d.status, effectiveFrom: d.effectiveFrom } };
  }

  /** تأیید حکم — فقط نقش تأییدکننده (حسابدار 403 می‌گیرد) */
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @Post('decisions/:id/approve')
  async approveDecision(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const d = await this.payroll.approveDecision(id, req.user.id);
    return { data: { id: d.id, status: d.status } };
  }

  /* ── دوره‌ها ── */

  /** محاسبه دوره — بازمحاسبه دوره پیش‌نویس مجاز است؛ دوره تأییدشده تغییرناپذیر */
  @RequirePermissions(PERMISSIONS.PAYROLL_CALCULATE)
  @Post('runs')
  async calculateRun(@Body() dto: CreateRunDto, @Req() req: AuthenticatedRequest) {
    const run = await this.payroll.calculateRun(dto.periodCode, req.user.id);
    return {
      data: {
        id: run.id,
        periodCode: run.periodCode,
        status: run.status,
        employeeCount: run.employeeCount,
        paramsVersion: run.paramsVersion,
        totals: {
          gross: run.grossRials.toString(),
          net: run.netRials.toString(),
          tax: run.taxRials.toString(),
          insuranceEmployee: run.insEmployeeRials.toString(),
          insuranceEmployer: run.insEmployerRials.toString(),
        },
        skipped: run.skippedJson ?? [],
      },
    };
  }

  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @Get('runs')
  async listRuns() {
    const rows = await this.payroll.listRuns();
    return {
      data: rows.map((r) => ({
        id: r.id,
        periodCode: r.periodCode,
        status: r.status,
        employeeCount: r.employeeCount,
        net: r.netRials.toString(),
      })),
      meta: { count: rows.length },
    };
  }

  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const run = await this.payroll.getRun(id);
    return {
      data: {
        id: run.id,
        periodCode: run.periodCode,
        status: run.status,
        employeeCount: run.employeeCount,
        paramsVersion: run.paramsVersion,
        totals: {
          gross: run.grossRials.toString(),
          net: run.netRials.toString(),
          tax: run.taxRials.toString(),
        },
        slips: run.slips.map((s) => ({
          employee: `${s.employee.code} — ${s.employee.firstName} ${s.employee.lastName}`,
          mizan: s.mizanRials.toString(),
          gross: s.grossRials.toString(),
          overtime: s.overtimeRials.toString(),
          ins: s.insEmployeeRials.toString(),
          tax: s.taxRials.toString(),
          net: s.netRials.toString(),
          paramsVersion: s.paramsVersion,
        })),
      },
    };
  }

  /* ── لیست‌های رسمی ── */

  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @Get('runs/:id/lists/tax')
  async taxList(@Param('id') id: string) {
    return { data: await this.payroll.taxListOf(id) };
  }

  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @Get('runs/:id/lists/insurance')
  async insuranceList(@Param('id') id: string) {
    return { data: await this.payroll.insuranceListOf(id) };
  }

  @RequirePermissions(PERMISSIONS.PAYROLL_VIEW)
  @Get('runs/:id/lists/bank')
  async bankList(@Param('id') id: string) {
    return { data: await this.payroll.bankListOf(id) };
  }

  /** تأیید دوره → رویداد → سند خودکار حقوق */
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @Post('runs/:id/approve')
  async approveRun(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const run = await this.payroll.approveRun(id, req.user.id);
    return { data: { id: run.id, status: run.status, approvedAt: run.approvedAt } };
  }
}
