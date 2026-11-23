import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

/**
 * ComplianceModule — فاز ۹: کتابخانهٔ قوانین (F9-T1) و اظهارنامهٔ ارزش افزوده (F9-T3).
 * ادغام مؤدیان (F9-T2) و معاملات فصلی (F9-T4) در ادامهٔ موج ۳.
 */
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService],
})
export class ComplianceModule {}
