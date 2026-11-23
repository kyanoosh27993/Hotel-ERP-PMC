import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

/**
 * WorkflowModule — فاز ۸ / F8-T6: موتور گردش کار تأیید چندمرحله‌ای + امضای الکترونیکی.
 * «تأییدکننده ≠ ثبت‌کننده» در هر مرحله؛ تکمیل نمونه → رویداد workflow.completed در Outbox.
 */
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService], // مصرف‌کننده‌های دامنه (مثلاً بستن فصل معاملات فصلی F9-T4)
})
export class WorkflowModule {}
