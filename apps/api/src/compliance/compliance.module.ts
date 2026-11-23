import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { MoadianController } from './moadian.controller';
import { MoadianService } from './moadian.service';
import { MoadianSimAdapter } from './moadian.adapter';

/**
 * ComplianceModule — فاز ۹: کتابخانه قوانین (F9-T1)، اظهارنامهٔ ارزش افزوده (F9-T3)
 * و ادغام مؤدیان / صورتحساب الکترونیکی (F9-T2).
 * Adapter مؤدیان قابل تعویض است: وقتی MOADIAN_BASE_URL پیکربانی شد، یک MoadianLiveAdapter
 * با همان قرارداد (MoadianAdapter interface) جایگزین sim می‌شود — فقط این خط تغییر می‌کند.
 */
@Module({
  controllers: [ComplianceController, MoadianController],
  providers: [ComplianceService, MoadianService, MoadianSimAdapter],
})
export class ComplianceModule {}
