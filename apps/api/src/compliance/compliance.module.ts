import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { MoadianController } from './moadian.controller';
import { MoadianService } from './moadian.service';
import { MoadianSimAdapter } from './moadian.adapter';
import { QuarterlyController } from './quarterly.controller';
import { QuarterlyService } from './quarterly.service';
import { WorkflowModule } from '../workflow/workflow.module';

/**
 * ComplianceModule — فاز ۹: کتابخانه قوانین (F9-T1)، اظهارنامهٔ ارزش افزوده (F9-T3)
 * و ادغام مؤدیان / صورتحساب الکترونیکی (F9-T2) + معاملات فصلی (F9-T4).
 * Adapter مؤدیان قابل تعویض است: وقتی MOADIAN_BASE_URL پیکربانی شد، یک MoadianLiveAdapter
 * با همان قرارداد (MoadianAdapter interface) جایگزین sim می‌شود — فقط این خط تغییر می‌کند.
 */
@Module({
  imports: [WorkflowModule], // بستن فصل معاملات فصلی از موتور گردش کار (F8-T6)
  controllers: [ComplianceController, MoadianController, QuarterlyController],
  providers: [ComplianceService, MoadianService, MoadianSimAdapter, QuarterlyService],
})
export class ComplianceModule {}
